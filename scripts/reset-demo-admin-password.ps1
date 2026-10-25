# Demo-only recovery: resets the *existing* RD Care admin password in
# Cloudflare D1. Do not use on a production database with student data.
# The password is never passed as a CLI argument or written into SQL.
# The temporary SQL file contains only a salted password hash.
$ErrorActionPreference = 'Stop'
$secure = Read-Host 'New demo admin password (12+ characters)' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $secure).Password

if ($password.Length -lt 12) {
    throw 'Password must contain at least 12 characters'
}

$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$saltBytes = New-Object byte[] 16
try {
    $random.GetBytes($saltBytes)
} finally {
    $random.Dispose()
}
$salt = [BitConverter]::ToString($saltBytes).Replace('-', '').ToLowerInvariant()

$kdf = [System.Security.Cryptography.Rfc2898DeriveBytes]::new(
    $password,
    [System.Text.Encoding]::UTF8.GetBytes($salt),
    100000,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
)
try {
    $hash = [BitConverter]::ToString($kdf.GetBytes(32)).Replace('-', '').ToLowerInvariant()
} finally {
    $kdf.Dispose()
}
# Only update the pre-existing demo administrator; never insert/replace users.
$sql = "UPDATE users SET password_salt='$salt', password_hash='$hash' WHERE username='admin' AND role='admin';"
$tempFile = Join-Path $env:TEMP ("rdcare-admin-reset-" + [guid]::NewGuid().ToString('N') + '.sql')
[System.IO.File]::WriteAllText($tempFile, $sql, [System.Text.UTF8Encoding]::new($false))
$workerDir = Join-Path $PSScriptRoot '..\worker'
try {
    Push-Location $workerDir
    try {
        & npx.cmd wrangler d1 execute rd-care-dev --remote "--file=$tempFile"
        if ($LASTEXITCODE -ne 0) { throw 'D1 password update failed' }
    } finally {
        Pop-Location
    }
    Write-Host 'D1 update command completed. Verify login with the new password.' -ForegroundColor Green
} finally {
    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    Remove-Variable password,secure,hash,salt,sql,saltBytes -ErrorAction SilentlyContinue
}
