<?php
/* CLI only. Age comes from the cron command, not PHP config.
   php cron-purge.php 90d
   php cron-purge.php 24h
   A bare number is days: php cron-purge.php 30 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not found';
    exit;
}

require_once __DIR__ . '/bc-anno-store.php';

$age = isset($argv[1]) ? (string) $argv[1] : '';
$sec = bc_parse_age($age);
if ($sec <= 0) {
    fwrite(STDERR, "Usage: php cron-purge.php <age>\nExample: php cron-purge.php 90d\n");
    exit(1);
}

$dir = __DIR__ . '/anno-data';
$r = bc_purge_old_json($dir, $sec, time());
echo 'purged files=' . (int) $r['removed'] . ' kept=' . (int) $r['kept'] . ' skipped=' . (int) $r['skipped'] . ' age=' . $age . "\n";
