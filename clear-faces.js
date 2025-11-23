// Clear all registered face descriptors from database
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'attendiq.db');
const db = new sqlite3.Database(dbPath);

console.log('🧹 Clearing all face descriptors from database...\n');

db.run('UPDATE profile_photos SET face_descriptor = NULL', function(err) {
  if (err) {
    console.error('❌ Error clearing faces:', err);
    db.close();
    process.exit(1);
  }
  
  console.log(`✅ Successfully cleared ${this.changes} face descriptor(s)`);
  console.log('💡 All students will need to re-register their faces\n');
  
  // Verify the update
  db.get('SELECT COUNT(*) as total FROM profile_photos WHERE face_descriptor IS NOT NULL', (err, row) => {
    if (err) {
      console.error('Error verifying:', err);
    } else {
      console.log(`📊 Remaining face descriptors: ${row.total}`);
    }
    
    db.close();
    console.log('\n✅ Done! Database closed.');
  });
});
