<?php
/* Hosted review HTML: safe slug + one-tag embed via index.php. */

function bc_page_slug($name) {
    $name = strtolower(trim((string) $name));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{0,80}$/', $name)) {
        return '';
    }
    return $name;
}

function bc_slug_from_filename($name) {
    $base = basename((string) $name);
    $base = preg_replace('/\.[^.]+$/', '', $base);
    $base = strtolower((string) $base);
    $base = preg_replace('/[^a-z0-9]+/', '-', $base);
    $base = trim($base, '-');
    return bc_page_slug($base);
}

function bc_urls_from_domain($domain) {
    $d = rtrim((string) $domain, '/');
    return array(
        'domain' => $d,
        'embed' => $d . '/index.php',
        'api' => $d . '/annotations.php',
        'pages' => $d . '/index.php',
    );
}

function bc_public_base() {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    $script = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/index.php';
    $dir = str_replace('\\', '/', dirname($script));
    if ($dir === '/') {
        $dir = '';
    }
    return ($https ? 'https://' : 'http://') . $host . $dir;
}

function bc_strip_annotator($html) {
    $html = (string) $html;
    $html = preg_replace('/<script[^>]*>\s*window\.ANNOTATOR_API\s*=\s*["\'][^"\']*["\']\s*;?\s*<\/script>\s*/i', '', $html);
    $html = preg_replace('/<script[^>]*src=["\'][^"\']*annotator\.js[^"\']*["\'][^>]*>\s*<\/script>\s*/i', '', $html);
    $html = preg_replace('/<script[^>]*src=["\'][^"\']*index\.php[^"\']*["\'][^>]*>\s*<\/script>\s*/i', '', $html);
    return $html;
}

function bc_inject_annotator($html, $embedSrc, $unusedApi = null) {
    unset($unusedApi);
    $html = bc_strip_annotator($html);
    $snip = '<script src=' . json_encode((string) $embedSrc, JSON_UNESCAPED_SLASHES) . '></script>' . "\n";
    if (stripos($html, '</body>') !== false) {
        return preg_replace('/<\/body>/i', $snip . '</body>', $html, 1);
    }
    return $html . "\n" . $snip;
}

function bc_page_file($dir, $slug) {
    return rtrim($dir, '/') . '/pages/' . $slug . '.html';
}
