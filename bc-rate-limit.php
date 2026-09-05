<?php
/* Sliding-window write limiter: $limit hits per $window seconds. */

function bc_rate_prune($times, $now, $window) {
    $out = array();
    foreach ($times as $t) {
        if (($now - (int) $t) < $window) {
            $out[] = (int) $t;
        }
    }
    return $out;
}

function bc_rate_record($times, $now, $limit, $window) {
    $times = bc_rate_prune($times, $now, $window);
    if (count($times) >= $limit) {
        return array('ok' => false, 'times' => $times);
    }
    $times[] = (int) $now;
    return array('ok' => true, 'times' => $times);
}

function bc_rate_file($dir, $ip) {
    return $dir . '/.rate-' . sha1($ip) . '.json';
}

function bc_client_ip() {
    $header = getenv('ANNOTATOR_CLIENT_IP_HEADER');
    if (is_string($header) && $header !== '') {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $header));
        if (!empty($_SERVER[$key])) {
            $parts = explode(',', (string) $_SERVER[$key]);
            $ip = trim($parts[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
}

function bc_rate_gc($dir, $now, $ttl) {
    $marker = rtrim((string) $dir, '/') . '/.rate-gc';
    $last = is_file($marker) ? (int) @file_get_contents($marker) : 0;
    if (($now - $last) < 120) {
        return;
    }
    @file_put_contents($marker, (string) $now, LOCK_EX);
    $files = glob(rtrim((string) $dir, '/') . '/.rate-*.json');
    if (!is_array($files)) {
        return;
    }
    $n = 0;
    foreach ($files as $f) {
        if ($n++ > 80) {
            break;
        }
        $mt = @filemtime($f);
        if ($mt !== false && ($now - $mt) > $ttl) {
            @unlink($f);
        }
    }
}

function bc_rate_hit($dir, $ip, $now, $limit, $window) {
    bc_rate_gc($dir, $now, 7200);
    $file = bc_rate_file($dir, $ip);
    $times = array();
    if (file_exists($file)) {
        $dec = json_decode((string) @file_get_contents($file), true);
        if (is_array($dec)) {
            $times = $dec;
        }
    }
    $r = bc_rate_record($times, $now, $limit, $window);
    @file_put_contents($file, json_encode($r['times']), LOCK_EX);
    return $r['ok'];
}
