<?php
/* Hosted HTML reviews (canonical URL is index.php?name=).
   GET  index.php?name=<slug>  -> HTML with annotator injected
   PUT  index.php?name=<slug>  -> save HTML (Bearer AI token)
   GET  pages.php?name=<slug>  -> 301 to index.php?name=
   PUT  pages.php?name=<slug>  -> same as index.php PUT
   AI token: env ANNOTATOR_AI_TOKEN or anno-data/.ai-token */
require_once __DIR__ . '/bc-rate-limit.php';
require_once __DIR__ . '/bc-anno-store.php';
require_once __DIR__ . '/bc-anno-pages.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$MAX_BYTES = 2 * 1024 * 1024;

function fail($code, $msg) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => $msg));
    exit;
}

function bc_pages_dir($dir) {
    $p = $dir . '/pages';
    if (!is_dir($p)) {
        @mkdir($p, 0755, true);
    }
    return $p;
}

$slug = bc_page_slug(isset($_GET['name']) ? $_GET['name'] : '');
if ($slug === '') {
    fail(400, 'missing or invalid name (use lowercase letters, digits, hyphen)');
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
bc_pages_dir($dir);
$file = bc_page_file($dir, $slug);
$method = $_SERVER['REQUEST_METHOD'];
$base = bc_public_base();
$embed = $base . '/index.php';
$api = $base . '/annotations.php';
$share = $embed . '?name=' . rawurlencode($slug);

if ($method === 'GET') {
    $script = isset($_SERVER['SCRIPT_NAME']) ? basename($_SERVER['SCRIPT_NAME']) : '';
    if ($script === 'pages.php') {
        header('Location: index.php?name=' . rawurlencode($slug), true, 301);
        exit;
    }
    if (!is_file($file)) {
        fail(404, 'page not found');
    }
    $html = (string) file_get_contents($file);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo bc_inject_annotator($html, $embed);
    exit;
}

if ($method === 'PUT') {
    $ip = bc_client_ip();
    if (!bc_rate_hit($dir, $ip, time(), 10, 60)) {
        header('Retry-After: 60');
        fail(429, 'rate limit');
    }
    $tok = bc_read_ai_token($dir);
    if (!bc_ai_ok(bc_bearer_header(), $tok)) {
        fail(401, 'need AI bearer token');
    }
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        fail(400, 'empty body');
    }
    if (strlen($body) > $MAX_BYTES) {
        fail(413, 'body too large');
    }
    $clean = bc_strip_annotator($body);
    if (file_put_contents($file, $clean, LOCK_EX) === false) {
        fail(500, 'write failed');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'ok' => true,
        'name' => $slug,
        'url' => $share,
        'comments' => $api . '?url=' . rawurlencode($share),
    ), JSON_UNESCAPED_SLASHES);
    exit;
}

fail(405, 'method not allowed');
