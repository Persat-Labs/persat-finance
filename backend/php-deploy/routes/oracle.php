<?php
declare(strict_types=1);

/**
 * Pyth Hermes BTC/USD proxy — fail-closed, short file cache under /tmp.
 * @return array{price:float,conf:float,publishTime:int,isStale:bool,maxConfidenceBps:int,ageSeconds:int}|null
 */
function persat_fetch_btc_usd(array $cfg): ?array
{
    $cacheFile = sys_get_temp_dir() . '/persat_btc_usd_cache.json';
    $ttl = 5; // seconds

    if (is_readable($cacheFile)) {
        $raw = @file_get_contents($cacheFile);
        $cached = $raw ? json_decode($raw, true) : null;
        if (is_array($cached) && isset($cached['at'], $cached['price']) && (time() - (int) $cached['at']) < $ttl) {
            return $cached['price'];
        }
    }

    $base = rtrim((string) ($cfg['pyth_hermes_url'] ?? 'https://hermes.pyth.network'), '/');
    $feed = (string) ($cfg['btc_usd_feed_id'] ?? '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43');
    $url = $base . '/v2/updates/price/latest?ids[]=' . rawurlencode($feed) . '&encoding=base64';

    $ctx = stream_context_create([
        'http' => [
            'timeout' => 5,
            'header'  => "Accept: application/json\r\nUser-Agent: persat-api-php/0.2\r\n",
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        return null;
    }
    $json = json_decode($body, true);
    $parsed = $json['parsed'][0] ?? null;
    if (!$parsed || !isset($parsed['price'])) {
        return null;
    }

    $priceRaw = (float) $parsed['price']['price'];
    $expo     = (int) $parsed['price']['expo'];
    $confRaw  = (float) $parsed['price']['conf'];
    $publish  = (int) $parsed['price']['publish_time'];

    $price = $priceRaw * pow(10, $expo);
    $conf  = $confRaw * pow(10, $expo);
    $confBps = $price > 0 ? ($conf / $price) * 10000 : 999999;
    $age = time() - $publish;
    $isStale = $age > 60;

    $result = [
        'price'            => $price,
        'conf'             => $conf,
        'publishTime'      => $publish,
        'isStale'          => $isStale,
        'maxConfidenceBps' => (int) round($confBps),
        'ageSeconds'       => $age,
    ];

    @file_put_contents($cacheFile, json_encode(['at' => time(), 'price' => $result]));
    return $result;
}
