<?php
declare(strict_types=1);

// COPY to config.local.php OUTSIDE the public web root, never commit or upload
// the local config into public_html. Use the exact cPanel MySQL database/user.
return [
    'database' => [
        'host' => 'localhost',
        'port' => 3306,
        'database' => 'CHANGE_TO_SCHOOL_MYSQL_DB',
        'username' => 'CHANGE_TO_SCHOOL_MYSQL_USER',
        'password' => 'CHANGE_LOCALLY_NEVER_COMMIT',
    ],
    // No admin bootstrap password, VAPID private key or session secret here.
    // These will be introduced only with audited auth/Push implementations.
];
