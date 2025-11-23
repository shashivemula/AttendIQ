const sqlite3 = require('sqlite3').verbose();

// Connect to database
const db = new sqlite3.Database('attendiq.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Check Alice Johnson's face registration status
function checkAliceFace() {
  console.log('\n🔍 Checking Alice Johnson\'s face registration status...\n');
  
  // First check if Alice exists in students table
  db.get('SELECT * FROM students WHERE email = ?', ['alice@test.com'], (err, student) => {
    if (err) {
      console.error('Database error:', err);
      return;
    }
    
    if (!student) {
      console.log('❌ Alice Johnson not found in students table');
      db.close();
      return;
    }
    
    console.log('✅ Alice Johnson found:');
    console.log(`   Student ID: ${student.student_id}`);
    console.log(`   Name: ${student.name}`);
    console.log(`   Email: ${student.email}`);
    console.log(`   Created: ${student.created_at}`);
    
    // Check if she has profile photo and face descriptor
    db.get('SELECT * FROM profile_photos WHERE student_id = ?', [student.student_id], (err, photo) => {
      if (err) {
        console.error('Database error:', err);
        db.close();
        return;
      }
      
      if (!photo) {
        console.log('\n❌ No profile photo found for Alice Johnson');
        console.log('   Status: Face NOT registered');
        console.log('   Action needed: Upload profile photo and register face');
      } else {
        console.log('\n✅ Profile photo found:');
        console.log(`   Photo path: ${photo.photo_path}`);
        console.log(`   Uploaded: ${photo.uploaded_at}`);
        
        if (!photo.face_descriptor) {
          console.log('   Face descriptor: ❌ NOT registered');
          console.log('   Status: Photo uploaded but face NOT registered');
          console.log('   Action needed: Complete face registration process');
        } else {
          console.log('   Face descriptor: ✅ REGISTERED');
          console.log('   Status: Face fully registered and ready for verification');
          
          // Parse and show descriptor info
          try {
            const descriptor = JSON.parse(photo.face_descriptor);
            console.log(`   Descriptor length: ${descriptor.length} values`);
            console.log(`   Sample values: [${descriptor.slice(0, 3).map(v => v.toFixed(3)).join(', ')}...]`);
          } catch (e) {
            console.log('   Descriptor: Invalid JSON format');
          }
        }
      }
      
      console.log('\n' + '='.repeat(50));
      db.close();
    });
  });
}

// Run the check
checkAliceFace();