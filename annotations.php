<?php
/* bc-annotator PHP backend v3
   GET  annotations.php?url=<pageUrl>
   PUT  annotations.php?url=<pageUrl>  JSON body + header X-Owner-Key (ACL merge)
   POST annotations.php?url=<pageUrl>&action=reply&id=<pubId>
        human: X-Owner-Key | AI: Authorization: Bearer <token>
   AI token: env ANNOTATOR_AI_TOKEN or anno-data/.ai-token */
require_once __DIR__ . '/bc-rate-limit.php';
require_once __DIR__ . '/bc-anno-store.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Owner-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$MAX_BYTES = 256 * 1024;

function fail($code, $msg) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => $msg));
    exit;
}

function bc_owner_header() {
    return isset($_SERVER['HTTP_X_OWNER_KEY']) ? (string) $_SERVER['HTTP_X_OWNER_KEY'] : '';
}

function bc_load_doc($file, $url) {
    if (!file_exists($file)) {
        return array(
            'v' => 3,
            'page' => array('url' => $url),
            'deletedIds' => array(),
            'annotations' => array(),
        );
    }
    $dec = json_decode((string) file_get_contents($file), true);
    if (!is_array($dec)) {
        return array(
            'v' => 3,
            'page' => array('url' => $url),
            'deletedIds' => array(),
            'annotations' => array(),
        );
    }
    if (!isset($dec['annotations']) || !is_array($dec['annotations'])) {
        $dec['annotations'] = array();
    }
    if (!isset($dec['deletedIds']) || !is_array($dec['deletedIds'])) {
        $dec['deletedIds'] = array();
    }
    $changed = false;
    foreach ($dec['annotations'] as $i => $a) {
        if (is_array($a) && empty($a['pubId'])) {
            $dec['annotations'][$i]['pubId'] = bc_next_pub_id($dec['annotations']);
            $changed = true;
        }
    }
    if ($changed) {
        @file_put_contents($file, json_encode($dec), LOCK_EX);
    }
    return $dec;
}

function bc_self_api() {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    $path = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/annotations.php';
    return ($https ? 'https://' : 'http://') . $host . $path;
}

$url = isset($_GET['url']) ? (string) $_GET['url'] : '';
if ($url === '' || strlen($url) > 2000) {
    fail(400, 'missing or invalid url param');
}

$dir = __DIR__ . '/anno-data';
if (!is_dir($dir)) {
    @mkdir($dir, 0755, true);
}

$ht = $dir . '/.htaccess';
if (!file_exists($ht)) {
    @file_put_contents($ht,
        "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n" .
        "<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
}

$file = $dir . '/' . sha1($url) . '.json';
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $doc = bc_load_doc($file, $url);
    $owner = bc_owner_header();
    foreach ($doc['annotations'] as $i => $a) {
        if (!is_array($a)) {
            continue;
        }
        $doc['annotations'][$i]['mine'] = bc_owns($a, $owner);
        $replies = isset($a['replies']) && is_array($a['replies']) ? $a['replies'] : array();
        foreach ($replies as $ri => $r) {
            if (is_array($r)) {
                $replies[$ri]['mine'] = bc_owns($r, $owner);
            }
        }
        $doc['annotations'][$i]['replies'] = $replies;
    }
    $out = bc_public_doc($doc, bc_self_api(), $url);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($out);
    exit;
}

if ($method === 'PUT') {
    $L = bc_limits();
    if (!bc_owner_key_ok(bc_owner_header())) {
        fail(401, 'need X-Owner-Key');
    }
    $ip = bc_client_ip();
    $now = time();
    if (!bc_rate_hit($dir, $ip, $now, $L['ipWrites'], $L['ipWindow'])) {
        header('Retry-After: 60');
        fail(429, 'rate limit');
    }
    if (!bc_rate_hit($dir, 'url:' . sha1($url), $now, $L['urlWrites'], $L['urlWindow'])) {
        header('Retry-After: 60');
        fail(429, 'rate limit');
    }
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        fail(400, 'empty body');
    }
    if (strlen($body) > $L['maxBytes']) {
        fail(413, 'body too large');
    }
    $incoming = json_decode($body, true);
    if (!is_array($incoming)) {
        fail(400, 'invalid json');
    }
    $isNew = !is_file($file);
    if ($isNew) {
        if (!bc_rate_hit($dir, 'new:' . $ip, $now, $L['newFiles'], $L['newWindow'])) {
            header('Retry-After: 600');
            fail(429, 'too many new pages');
        }
        if (bc_json_doc_count($dir) >= $L['maxDataFiles']) {
            fail(507, 'storage full');
        }
    }
    $cur = bc_load_doc($file, $url);
    $merged = bc_acl_merge($cur, $incoming, bc_owner_header());
    $qerr = bc_quota_error($cur, $merged);
    if ($qerr !== '') {
        fail(413, $qerr);
    }
    if (file_put_contents($file, json_encode($merged), LOCK_EX) === false) {
        fail(500, 'write failed');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('ok' => true));
    exit;
}

if ($method === 'POST') {
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
    $pubId = isset($_GET['id']) ? (string) $_GET['id'] : '';
    if ($action !== 'reply' || $pubId === '') {
        fail(400, 'POST supports action=reply&id=<pubId>');
    }
    $L = bc_limits();
    $ip = bc_client_ip();
    $now = time();
    if (!bc_rate_hit($dir, $ip, $now, $L['ipWrites'], $L['ipWindow'])) {
        header('Retry-After: 60');
        fail(429, 'rate limit');
    }
    if (!bc_rate_hit($dir, 'url:' . sha1($url), $now, $L['urlWrites'], $L['urlWindow'])) {
        header('Retry-After: 60');
        fail(429, 'rate limit');
    }
    $body = file_get_contents('php://input');
    if ($body !== false && strlen($body) > $L['maxBytes']) {
        fail(413, 'body too large');
    }
    $payload = json_decode($body ? $body : '{}', true);
    if (!is_array($payload)) {
        fail(400, 'invalid json');
    }
    $text = isset($payload['text']) ? trim((string) $payload['text']) : '';
    if ($text === '') {
        fail(400, 'missing text');
    }
    if (bc_char_len($text) > $L['maxText']) {
        fail(413, 'reply too long');
    }
    $owner = bc_owner_header();
    $bearer = bc_bearer_header();
    $aiTok = bc_read_ai_token($dir);
    $isAi = bc_ai_ok($bearer, $aiTok);
    if (!$isAi && !bc_owner_key_ok($owner)) {
        fail(401, 'need X-Owner-Key or AI bearer token');
    }
    $actor = $isAi ? array('type' => 'ai') : array('type' => 'human', 'ownerKey' => $owner);
    $author = isset($payload['author']) ? (string) $payload['author'] : ($isAi ? 'AI' : '');
    if (bc_char_len($author) > $L['maxAuthor']) {
        fail(413, 'author too long');
    }
    $doc = bc_load_doc($file, $url);
    $idx = bc_find_pub($doc, $pubId);
    if ($idx >= 0) {
        $have = isset($doc['annotations'][$idx]['replies']) && is_array($doc['annotations'][$idx]['replies'])
            ? $doc['annotations'][$idx]['replies'] : array();
        if (count($have) >= $L['maxReplies']) {
            fail(413, 'too many replies');
        }
    }
    $reply = array(
        'id' => 'r' . uniqid(),
        'author' => $author,
        'text' => $text,
        'ts' => gmdate('Y-m-d\TH:i:s.000\Z'),
        'resolved' => false,
    );
    $next = bc_apply_reply($doc, $pubId, $reply, $actor);
    if ($next === null) {
        fail(404, 'comment not found');
    }
    if (file_put_contents($file, json_encode($next), LOCK_EX) === false) {
        fail(500, 'write failed');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('ok' => true, 'pubId' => $pubId, 'reply' => array(
        'id' => $reply['id'], 'author' => $author, 'text' => $text, 'ts' => $reply['ts'],
    )));
    exit;
}

fail(405, 'method not allowed');
