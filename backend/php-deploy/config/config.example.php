<?php
/**
 * Copy this file to config.local.php on LyteHosting and fill real values.
 * NEVER commit config.local.php (gitignored).
 *
 * cPanel → MySQL Databases → create DB + user → ALL PRIVILEGES
 * Host is almost always "localhost" when PHP runs on the same cPanel account.
 */
declare(strict_types=1);

return [
    // MySQL (LyteHosting cPanel)
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'cpaneluser_persat',   // full name shown in cPanel
    'db_user' => 'cpaneluser_persat',
    'db_pass' => 'CHANGE_ME_STRONG_PASSWORD',

    // Public app origins allowed for browser CORS
    'cors_origins' => [
        'https://dapp.persat.finance',
        'https://persat.finance',
        'https://www.persat.finance',
        'http://localhost:3000',
    ],

    // Shown in SIWS challenge message
    'app_url' => 'https://dapp.persat.finance',
    'cluster' => 'devnet',

    // Pyth Hermes (public; no key)
    'pyth_hermes_url' => 'https://hermes.pyth.network',
    'btc_usd_feed_id' => '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',

    // Session / challenge TTLs
    'challenge_ttl_seconds' => 300,      // 5 minutes
    'session_ttl_seconds'   => 86400,    // 24 hours

    // Optional later — NOT used by pure PHP stack (needs Node sidecar for SPL mint)
    // 'deployer_keypair_json' => null,
];
