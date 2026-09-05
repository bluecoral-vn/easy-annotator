<?php
/* Shared-hosting comment store: pub ids, owner ACL, AI reply. */

function bc_pub_id_from_index($n) {
    $n = max(0, (int) $n);
    $series = (int) floor($n / 99);
    $num = ($n % 99) + 1;
    $pad = $num < 10 ? ('0' . $num) : (string) $num;
    return chr(65 + $series) . $pad;
}

function bc_next_pub_id($annos) {
    $used = array();
    $max = -1;
    foreach ((array) $annos as $a) {
        if (empty($a['pubId'])) {
            continue;
        }
        $used[$a['pubId']] = true;
        if (!preg_match('/^([A-Z])(\d{2})$/', $a['pubId'], $m)) {
            continue;
        }
        $num = (int) $m[2];
        if ($num < 1 || $num > 99) {
            continue;
        }
        $series = ord($m[1]) - 65;
        $idx = $series * 99 + ($num - 1);
        if ($idx > $max) {
            $max = $idx;
        }
    }
    $n = $max + 1;
    while (isset($used[bc_pub_id_from_index($n)])) {
        $n++;
    }
    return bc_pub_id_from_index($n);
}

function bc_owns($row, $ownerKey) {
    if (!is_array($row)) {
        return false;
    }
    if (empty($row['ownerId'])) {
        return true;
    }
    return $ownerKey !== '' && $row['ownerId'] === $ownerKey;
}

function bc_ai_ok($got, $expected) {
    if ($expected === '' || $got === '') {
        return false;
    }
    return hash_equals((string) $expected, (string) $got);
}

function bc_read_ai_token($dir) {
    $e = getenv('ANNOTATOR_AI_TOKEN');
    if (is_string($e) && $e !== '') {
        return $e;
    }
    $f = rtrim((string) $dir, '/') . '/.ai-token';
    if (is_file($f)) {
        return trim((string) file_get_contents($f));
    }
    return '';
}

function bc_bearer_header() {
    $h = isset($_SERVER['HTTP_AUTHORIZATION']) ? (string) $_SERVER['HTTP_AUTHORIZATION'] : '';
    if (stripos($h, 'Bearer ') === 0) {
        return trim(substr($h, 7));
    }
    return '';
}

function bc_strip_secrets($doc) {
    $doc = is_array($doc) ? $doc : array();
    $out = array(
        'v' => isset($doc['v']) ? $doc['v'] : 3,
        'page' => isset($doc['page']) ? $doc['page'] : array(),
        'deletedIds' => isset($doc['deletedIds']) ? $doc['deletedIds'] : array(),
        'annotations' => array(),
    );
    foreach ((array) (isset($doc['annotations']) ? $doc['annotations'] : array()) as $a) {
        if (!is_array($a)) {
            continue;
        }
        unset($a['ownerId']);
        $replies = array();
        foreach ((array) (isset($a['replies']) ? $a['replies'] : array()) as $r) {
            if (!is_array($r)) {
                continue;
            }
            unset($r['ownerId']);
            $replies[] = $r;
        }
        $a['replies'] = $replies;
        $out['annotations'][] = $a;
    }
    return $out;
}

function bc_index_annos($annos) {
    $map = array();
    foreach ((array) $annos as $a) {
        if (is_array($a) && !empty($a['id'])) {
            $map[$a['id']] = $a;
        }
    }
    return $map;
}

function bc_merge_replies($existing, $incoming, $ownerKey) {
    $map = array();
    foreach ((array) $existing as $r) {
        if (is_array($r) && !empty($r['id'])) {
            $map[$r['id']] = $r;
        }
    }
    foreach ((array) $incoming as $r) {
        if (!is_array($r) || empty($r['id'])) {
            continue;
        }
        if (!isset($map[$r['id']])) {
            if ($ownerKey !== '') {
                $r['ownerId'] = $ownerKey;
            }
            $map[$r['id']] = $r;
            continue;
        }
        if (bc_owns($map[$r['id']], $ownerKey)) {
            $keep = $map[$r['id']];
            $r['ownerId'] = isset($keep['ownerId']) ? $keep['ownerId'] : $ownerKey;
            $map[$r['id']] = $r;
        }
    }
    return array_values($map);
}

function bc_acl_merge($cur, $incoming, $ownerKey) {
    $cur = is_array($cur) ? $cur : array();
    $incoming = is_array($incoming) ? $incoming : array();
    $ownerKey = (string) $ownerKey;
    $map = bc_index_annos(isset($cur['annotations']) ? $cur['annotations'] : array());
    $inList = isset($incoming['annotations']) ? $incoming['annotations'] : array();
    foreach ((array) $inList as $a) {
        if (!is_array($a) || empty($a['id'])) {
            continue;
        }
        $id = $a['id'];
        if (!isset($map[$id])) {
            if ($ownerKey !== '') {
                $a['ownerId'] = $ownerKey;
            }
            if (empty($a['pubId'])) {
                $a['pubId'] = bc_next_pub_id(array_values($map));
            }
            if (!isset($a['replies']) || !is_array($a['replies'])) {
                $a['replies'] = array();
            }
            $map[$id] = $a;
            continue;
        }
        $ex = $map[$id];
        if (bc_owns($ex, $ownerKey)) {
            $a['ownerId'] = isset($ex['ownerId']) ? $ex['ownerId'] : $ownerKey;
            $a['pubId'] = isset($ex['pubId']) ? $ex['pubId'] : (isset($a['pubId']) ? $a['pubId'] : bc_next_pub_id(array_values($map)));
            $a['replies'] = bc_merge_replies(isset($ex['replies']) ? $ex['replies'] : array(), isset($a['replies']) ? $a['replies'] : array(), $ownerKey);
            $map[$id] = $a;
        } else {
            $ex['replies'] = bc_merge_replies(isset($ex['replies']) ? $ex['replies'] : array(), isset($a['replies']) ? $a['replies'] : array(), $ownerKey);
            $map[$id] = $ex;
        }
    }
    $tombs = array();
    foreach (array_merge(
        (array) (isset($cur['deletedIds']) ? $cur['deletedIds'] : array()),
        (array) (isset($incoming['deletedIds']) ? $incoming['deletedIds'] : array())
    ) as $t) {
        if (!is_array($t) || empty($t['id'])) {
            continue;
        }
        $id = $t['id'];
        if (isset($map[$id]) && !bc_owns($map[$id], $ownerKey)) {
            continue;
        }
        $tombs[$id] = $t;
        unset($map[$id]);
    }
    return array(
        'v' => 3,
        'page' => isset($incoming['page']) ? $incoming['page'] : (isset($cur['page']) ? $cur['page'] : array()),
        'deletedIds' => array_values($tombs),
        'annotations' => array_values($map),
    );
}

function bc_find_pub($doc, $pubId) {
    foreach ((array) (isset($doc['annotations']) ? $doc['annotations'] : array()) as $i => $a) {
        if (is_array($a) && isset($a['pubId']) && $a['pubId'] === $pubId) {
            return $i;
        }
    }
    return -1;
}

function bc_apply_reply($doc, $pubId, $reply, $actor) {
    $doc = is_array($doc) ? $doc : array();
    $idx = bc_find_pub($doc, $pubId);
    if ($idx < 0 || !is_array($reply) || empty($reply['text'])) {
        return null;
    }
    if (!isset($doc['annotations'][$idx]['replies']) || !is_array($doc['annotations'][$idx]['replies'])) {
        $doc['annotations'][$idx]['replies'] = array();
    }
    if (empty($reply['id'])) {
        $reply['id'] = 'r' . uniqid();
    }
    if (!isset($reply['ts'])) {
        $reply['ts'] = gmdate('Y-m-d\TH:i:s.000\Z');
    }
    if (!isset($reply['resolved'])) {
        $reply['resolved'] = false;
    }
    $type = is_array($actor) && isset($actor['type']) ? $actor['type'] : 'human';
    if ($type === 'ai') {
        $reply['ownerId'] = '__ai';
    } elseif ($type === 'human' && !empty($actor['ownerKey'])) {
        $reply['ownerId'] = $actor['ownerKey'];
    }
    $doc['annotations'][$idx]['replies'][] = $reply;
    $doc['annotations'][$idx]['updatedAt'] = $reply['ts'];
    $doc['v'] = 3;
    return $doc;
}

function bc_public_doc($doc, $apiBase, $pageUrl) {
    $doc = bc_strip_secrets($doc);
    $sep = strpos($apiBase, '?') === false ? '?' : '&';
    $list = $apiBase . $sep . 'url=' . rawurlencode($pageUrl);
    foreach ($doc['annotations'] as &$a) {
        if (empty($a['pubId'])) {
            continue;
        }
        $a['links'] = array(
            'list' => $list,
            'reply' => $list . '&action=reply&id=' . rawurlencode($a['pubId']),
        );
    }
    unset($a);
    $doc['links'] = array('list' => $list);
    return $doc;
}

function bc_limits() {
    return array(
        'maxBytes' => 256 * 1024,
        'maxText' => 4000,
        'maxAnnos' => 200,
        'maxReplies' => 40,
        'maxNewPerPut' => 8,
        'maxAuthor' => 80,
        'maxDataFiles' => 8000,
        'ipWrites' => 10,
        'ipWindow' => 60,
        'urlWrites' => 40,
        'urlWindow' => 60,
        'newFiles' => 8,
        'newWindow' => 600,
        'ownerKeyMin' => 8,
        'ownerKeyMax' => 128,
    );
}

function bc_char_len($s) {
    $s = (string) $s;
    if (function_exists('mb_strlen')) {
        return mb_strlen($s, 'UTF-8');
    }
    return strlen($s);
}

function bc_owner_key_ok($k) {
    $k = (string) $k;
    $L = bc_limits();
    $n = strlen($k);
    if ($n < $L['ownerKeyMin'] || $n > $L['ownerKeyMax']) {
        return false;
    }
    return (bool) preg_match('/^[A-Za-z0-9._:-]+$/', $k);
}

function bc_quota_error($cur, $merged) {
    $L = bc_limits();
    $cur = is_array($cur) ? $cur : array();
    $merged = is_array($merged) ? $merged : array();
    $old = array();
    foreach ((array) (isset($cur['annotations']) ? $cur['annotations'] : array()) as $a) {
        if (is_array($a) && !empty($a['id'])) {
            $old[$a['id']] = true;
        }
    }
    $annos = isset($merged['annotations']) && is_array($merged['annotations']) ? $merged['annotations'] : array();
    if (count($annos) > $L['maxAnnos']) {
        return 'too many notes on this page';
    }
    $new = 0;
    foreach ($annos as $a) {
        if (!is_array($a)) {
            continue;
        }
        if (!empty($a['id']) && !isset($old[$a['id']])) {
            $new++;
        }
        if (isset($a['author']) && bc_char_len($a['author']) > $L['maxAuthor']) {
            return 'author too long';
        }
        foreach ((array) (isset($a['edits']) ? $a['edits'] : array()) as $ed) {
            $t = is_array($ed) && isset($ed['text']) ? $ed['text'] : '';
            if (bc_char_len($t) > $L['maxText']) {
                return 'note too long';
            }
        }
        $replies = isset($a['replies']) && is_array($a['replies']) ? $a['replies'] : array();
        if (count($replies) > $L['maxReplies']) {
            return 'too many replies';
        }
        foreach ($replies as $r) {
            $t = is_array($r) && isset($r['text']) ? $r['text'] : '';
            if (bc_char_len($t) > $L['maxText']) {
                return 'reply too long';
            }
            if (is_array($r) && isset($r['author']) && bc_char_len($r['author']) > $L['maxAuthor']) {
                return 'author too long';
            }
        }
    }
    if ($new > $L['maxNewPerPut']) {
        return 'too many new notes in one save';
    }
    return '';
}

function bc_json_doc_count($dir) {
    $n = 0;
    $files = glob(rtrim((string) $dir, '/') . '/*.json');
    if (!is_array($files)) {
        return 0;
    }
    foreach ($files as $f) {
        $base = basename($f);
        if ($base === '' || $base[0] === '.') {
            continue;
        }
        $n++;
    }
    return $n;
}

function bc_parse_age($spec) {
    $spec = trim((string) $spec);
    if ($spec === '') {
        return 0;
    }
    if (preg_match('/^(\d+)\s*d$/i', $spec, $m)) {
        return (int) $m[1] * 86400;
    }
    if (preg_match('/^(\d+)\s*h$/i', $spec, $m)) {
        return (int) $m[1] * 3600;
    }
    if (preg_match('/^(\d+)\s*m$/i', $spec, $m)) {
        return (int) $m[1] * 60;
    }
    if (preg_match('/^(\d+)$/', $spec, $m)) {
        return (int) $m[1] * 86400;
    }
    return 0;
}

function bc_parse_ts($s) {
    $s = trim((string) $s);
    if ($s === '') {
        return 0;
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/', $s, $m)) {
        $t = strtotime($m[1] . ' UTC');
        return $t ? $t : 0;
    }
    $t = strtotime($s);
    return $t ? $t : 0;
}

function bc_comment_ts($row) {
    $best = 0;
    if (!is_array($row)) {
        return 0;
    }
    foreach (array('updatedAt', 'createdAt', 'ts') as $k) {
        if (!empty($row[$k])) {
            $best = max($best, bc_parse_ts($row[$k]));
        }
    }
    foreach ((array) (isset($row['edits']) ? $row['edits'] : array()) as $ed) {
        if (is_array($ed) && !empty($ed['ts'])) {
            $best = max($best, bc_parse_ts($ed['ts']));
        }
    }
    foreach ((array) (isset($row['replies']) ? $row['replies'] : array()) as $r) {
        $best = max($best, bc_comment_ts($r));
    }
    return $best;
}

function bc_doc_last_ts($doc, $fileMtime) {
    $best = 0;
    $doc = is_array($doc) ? $doc : array();
    foreach ((array) (isset($doc['annotations']) ? $doc['annotations'] : array()) as $a) {
        $best = max($best, bc_comment_ts($a));
    }
    foreach ((array) (isset($doc['deletedIds']) ? $doc['deletedIds'] : array()) as $t) {
        $best = max($best, bc_comment_ts($t));
    }
    if ($best <= 0) {
        return (int) $fileMtime;
    }
    return $best;
}

function bc_is_page_json($path) {
    return (bool) preg_match('/^[a-f0-9]{40}\.json$/', basename((string) $path));
}

function bc_purge_old_json($dir, $maxAgeSec, $now) {
    $dir = rtrim((string) $dir, '/');
    $maxAgeSec = (int) $maxAgeSec;
    $now = (int) $now;
    $out = array('removed' => 0, 'kept' => 0, 'skipped' => 0);
    if ($maxAgeSec <= 0 || $dir === '' || !is_dir($dir)) {
        return $out;
    }
    $cutoff = $now - $maxAgeSec;
    $files = glob($dir . '/*.json');
    if (!is_array($files)) {
        return $out;
    }
    foreach ($files as $f) {
        if (!bc_is_page_json($f)) {
            $out['skipped']++;
            continue;
        }
        $raw = @file_get_contents($f);
        $doc = is_string($raw) ? json_decode($raw, true) : null;
        $mtime = @filemtime($f);
        $last = bc_doc_last_ts(is_array($doc) ? $doc : array(), $mtime ? $mtime : 0);
        if ($last >= $cutoff) {
            $out['kept']++;
            continue;
        }
        if (@unlink($f)) {
            $out['removed']++;
        } else {
            $out['skipped']++;
        }
    }
    return $out;
}
