const fs = require('fs');
const forge = require('node-forge');

// Simple SSL certificate generator for development
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [{
  name: 'commonName',
  value: 'localhost'
}, {
  name: 'organizationName',
  value: 'AttendIQ'
}];

cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey);

// Convert to PEM format
const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certPem = forge.pki.certificateToPem(cert);

// Write files
fs.writeFileSync('server.key', privateKeyPem);
fs.writeFileSync('server.cert', certPem);

console.log('✅ SSL certificates generated:');
console.log('   server.key - Private key');
console.log('   server.cert - Certificate');
console.log('🔒 HTTPS server ready for mobile GPS access');