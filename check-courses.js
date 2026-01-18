import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Course from './models/Course.js';

dotenv.config();

const checkCourses = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/primeopsdb';
    
    await mongoose.connect(mongoUri, {
      dbName: 'primeops'
    });
    
    console.log('✅ Connected to MongoDB');
    
    const courses = await Course.find({});
    
    console.log('\n📚 All Courses in Database:');
    console.log('═══════════════════════════════════════════════════════════');
    
    courses.forEach((course, index) => {
      console.log(`\n${index + 1}. Course ID: ${course.courseId}`);
      console.log(`   Name: "${course.name}"`);
      console.log(`   Name (lowercase): "${course.name.trim().toLowerCase()}"`);
      console.log(`   Category: ${course.category}`);
      console.log(`   Status: ${course.status}`);
    });
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`\n✅ Total Courses: ${courses.length}`);
    
    await mongoose.connection.close();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

checkCourses();
