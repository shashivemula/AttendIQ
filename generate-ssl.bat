@echo off
echo Generating SSL certificates for HTTPS...

powershell -Command "& {
    $cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'cert:\LocalMachine\My' -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(1)
    $pwd = ConvertTo-SecureString -String 'password' -Force -AsPlainText
    $path = 'cert:\LocalMachine\My\' + $cert.Thumbprint
    Export-PfxCertificate -Cert $path -FilePath 'server.pfx' -Password $pwd
    $cert = Get-Content 'server.pfx' -Encoding Byte
    [System.IO.File]::WriteAllBytes('server.pfx', $cert)
}"

echo SSL certificate generated as server.pfx
echo Run: node convert-cert.js to convert to .key and .cert files
pause