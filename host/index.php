<?php
/* One public entry:
   GET index.php              -> demo HTML in a browser, embed JS as <script src>
   GET index.php?embed=1      -> embed JS (force)
   GET index.php?name=<slug>  -> hosted review HTML
   PUT index.php?name=<slug>  -> save HTML (AI bearer) */
require_once __DIR__ . '/bc-anno-pages.php';

$name = isset($_GET['name']) ? (string) $_GET['name'] : '';
if ($name !== '') {
    require __DIR__ . '/pages.php';
    exit;
}

$dest = isset($_SERVER['HTTP_SEC_FETCH_DEST']) ? strtolower((string) $_SERVER['HTTP_SEC_FETCH_DEST']) : '';
$accept = isset($_SERVER['HTTP_ACCEPT']) ? (string) $_SERVER['HTTP_ACCEPT'] : '';
$forceJs = isset($_GET['embed']) && $_GET['embed'] !== '' && $_GET['embed'] !== '0';
$asDocument = ($dest === 'document' || $dest === 'iframe' || $dest === 'frame' || $dest === 'embed');
$asScript = ($forceJs || $dest === 'script');
if (!$asScript && !$asDocument) {
    $asDocument = (strpos($accept, 'text/html') !== false);
    $asScript = !$asDocument;
}

if ($asScript) {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Cache-Control: no-cache');
    $api = bc_public_base() . '/annotations.php';
    echo 'window.ANNOTATOR_API=' . json_encode($api, JSON_UNESCAPED_SLASHES) . ";\n";
    readfile(__DIR__ . '/annotator.js');
    exit;
}

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
readfile(__DIR__ . '/index.html');
