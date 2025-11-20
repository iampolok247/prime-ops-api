// import dotenv from 'dotenv';
// import { connectDB } from './config/db.js';
// import User from './models/User.js';
// import { hashPassword } from './utils/hash.js';

// dotenv.config();

// const users = [
//   // Super Admin
//   { name: 'Ikhtiar Rahman', email: 'ikhtiar@theprimecollege.org.uk', role: 'SuperAdmin', department: 'Management', designation: 'CEO', phone: '447500880645' },
//   { name: 'Kazi Sazzad', email: 'kazi@theprimecollege.org.uk', role: 'SuperAdmin', department: 'Marketing', designation: 'Head of Marketing', phone: '447809443656' },
//   { name: 'Shahriar Arafat', email: 'shahriar@theprimecollege.org.uk', role: 'SuperAdmin', department: 'Operations', designation: 'Director Of Operations', phone: '447780114420' },
//   { name: 'Raj Pahal', email: 'raj@theprimecollege.org.uk', role: 'SuperAdmin', department: 'Partnership', designation: 'Director Of Partnerships', phone: '447747417531' },
//   { name: 'Pauline Price', email: 'pauline@theprimecollege.org.uk', role: 'SuperAdmin', department: 'Operations', designation: 'Chief Operating Officer', phone: '447387839331' },

//   // Admin
//   { name: 'Rafsaniat Binte Mustafiz', email: 'rafsaniat@primeacademy.org', role: 'Admin', department: 'Operations', designation: 'Operations Manager', phone: '01322924121' },
//   { name: 'Md.Shahidul Islam', email: 'shahidul@primeacademy.org', role: 'Admin', department: 'Academic', designation: 'Director (Academic Strategy and Growth)', phone: '01719000994' },

//   // Accountant
//   { name: 'Sheikh Mahbubul Islam', email: 'mahbub@primeacademy.org', role: 'Accountant', department: 'Finance', designation: 'Assistant Manager', phone: '01322924120' },

//   // Recruitment
//   { name: 'Syed Tanvir Hossain Alin', email: 'tanvir@primeacademy.org', role: 'Recruitment', department: 'Recruitment', designation: 'Business Development Manager', phone: '01322924128' },
//   { name: 'Farzana Yasmin Tumpa', email: 'farzana@primeacademy.org', role: 'Recruitment', department: 'Recruitment', designation: 'Public Relations Manager', phone: '01322924122' },
//   { name: 'Farhan Sadik', email: 'farhan@primeacademy.org', role: 'Recruitment', department: 'Recruitment', designation: 'Business Development Executive', phone: '01322924125' },

//   // Admission
//   { name: 'Sajrin Bashar', email: 'sajrin@primeacademy.org', role: 'Admission', department: 'Admission', designation: 'Sr. Business Development Executive', phone: '01322924124' },
//   { name: 'Rukaya Ruksad', email: 'ruksad@primeacademy.org', role: 'Admission', department: 'Admission', designation: 'Business Development Executive', phone: '01322924127' },
//   { name: 'Rifat Parvin', email: 'rifat@primeacademy.org', role: 'Admission', department: 'Admission', designation: 'Sr.Admissions Executive', phone: '01684239454' },
//   { name: 'Hayat Mahmud', email: 'hayat@primeacademy.org', role: 'Admission', department: 'Admission', designation: 'Admissions Executive', phone: '01322924126' },
//   { name: 'Sabrina Akter', email: 'sabrina@primeacademy.org', role: 'Admission', department: 'Admission', designation: 'Admissions Executive', phone: '01630592265' },

//   // Digital Marketing
//   { name: 'J.R Polok', email: 'polok@primeacademy.org', role: 'DigitalMarketing', department: 'Marketing', designation: 'Digital Marketing Executive', phone: '01410573107' },

//   // Motion Graphics
//   { name: 'Shuvo Kumar Das', email: 'shuvo@primeacademy.org', role: 'MotionGraphics', department: 'Creative', designation: 'Motion Graphics Designer', phone: '01716716788' },

//   // Coordinator
//   { name: 'Zerin Tasnim', email: 'zerin@primeacademy.org', role: 'Coordinator', department: 'Operations', designation: 'Academic Co-Ordinator', phone: '01322924123' }
// ];

// (async () => {
//   try {
//     await connectDB(process.env.MONGO_URI);
//     await User.deleteMany({});
//     const pwd = await hashPassword('password123'); // default password
//     const docs = await User.insertMany(users.map(u => ({ ...u, password: pwd })));
//     console.log(`✅ Seeded ${docs.length} users. Default password: password123`);
//     process.exit(0);
//   } catch (e) {
//     console.error('❌ Seed error:', e.message);
//     process.exit(1);
//   }
// })();

import User from "./models/User.js";
import { hashPassword } from "./utils/hash.js";

export const initialUsers = [
  // Super Admin
  {
    name: "Ikhtiar Rahman",
    email: "ikhtiar@theprimecollege.org.uk",
    role: "SuperAdmin",
    department: "Management",
    designation: "CEO",
    phone: "447500880645",
  },
  {
    name: "Kazi Sazzad",
    email: "kazi@theprimecollege.org.uk",
    role: "SuperAdmin",
    department: "Marketing",
    designation: "Head of Marketing",
    phone: "447809443656",
  },
  {
    name: "Shahriar Arafat",
    email: "shahriar@theprimecollege.org.uk",
    role: "SuperAdmin",
    department: "Operations",
    designation: "Director Of Operations",
    phone: "447780114420",
  },
  {
    name: "Raj Pahal",
    email: "raj@theprimecollege.org.uk",
    role: "SuperAdmin",
    department: "Partnership",
    designation: "Director Of Partnerships",
    phone: "447747417531",
  },
  {
    name: "Pauline Price",
    email: "pauline@theprimecollege.org.uk",
    role: "SuperAdmin",
    department: "Operations",
    designation: "Chief Operating Officer",
    phone: "447387839331",
  },

  // Admin
  {
    name: "Rafsaniat Binte Mustafiz",
    email: "rafsaniat@primeacademy.org",
    role: "Admin",
    department: "Operations",
    designation: "Operations Manager",
    phone: "01322924121",
  },
  {
    name: "Md.Shahidul Islam",
    email: "shahidul@primeacademy.org",
    role: "Admin",
    department: "Academic",
    designation: "Director (Academic Strategy & Growth)",
    phone: "01719000994",
  },

  // Accountant
  {
    name: "Sheikh Mahbubul Islam",
    email: "mahbub@primeacademy.org",
    role: "Accountant",
    department: "Finance",
    designation: "Assistant Manager",
    phone: "01322924120",
  },

  // Recruitment
  {
    name: "Syed Tanvir Hossain Alin",
    email: "tanvir@primeacademy.org",
    role: "Recruitment",
    department: "Recruitment",
    designation: "Business Development Manager",
    phone: "01322924128",
  },
  {
    name: "Farzana Yasmin Tumpa",
    email: "farzana@primeacademy.org",
    role: "Recruitment",
    department: "Recruitment",
    designation: "Public Relations Manager",
    phone: "01322924122",
  },
  {
    name: "Farhan Sadik",
    email: "farhan@primeacademy.org",
    role: "Recruitment",
    department: "Recruitment",
    designation: "Business Development Executive",
    phone: "01322924125",
  },

  // Admission
  {
    name: "Sajrin Bashar",
    email: "sajrin@primeacademy.org",
    role: "Admission",
    department: "Admission",
    designation: "Sr. Business Development Executive",
    phone: "01322924124",
  },
  {
    name: "Rukaya Ruksad",
    email: "ruksad@primeacademy.org",
    role: "Admission",
    department: "Admission",
    designation: "Business Development Executive",
    phone: "01322924127",
  },
  {
    name: "Rifat Parvin",
    email: "rifat@primeacademy.org",
    role: "Admission",
    department: "Admission",
    designation: "Sr. Admissions Executive",
    phone: "01684239454",
  },
  {
    name: "Hayat Mahmud",
    email: "hayat@primeacademy.org",
    role: "Admission",
    department: "Admission",
    designation: "Admissions Executive",
    phone: "01322924126",
  },
  {
    name: "Sabrina Akter",
    email: "sabrina@primeacademy.org",
    role: "Admission",
    department: "Admission",
    designation: "Admissions Executive",
    phone: "01630592265",
  },

  // Digital Marketing
  {
    name: "J.R Polok",
    email: "polok@primeacademy.org",
    role: "DigitalMarketing",
    department: "Marketing",
    designation: "Digital Marketing Executive",
    phone: "01410573107",
  },

  // Motion Graphics
  {
    name: "Shuvo Kumar Das",
    email: "shuvo@primeacademy.org",
    role: "MotionGraphics",
    department: "Creative",
    designation: "Motion Graphics Designer",
    phone: "01716716788",
  },

  // Coordinator
  {
    name: "Zerin Tasnim",
    email: "zerin@primeacademy.org",
    role: "Coordinator",
    department: "Operations",
    designation: "Academic Co-Ordinator",
    phone: "01322924123",
  },
];

export async function seedInitialUsers() {
  try {
    if (process.env.NODE_ENV === "production") {
      console.log("⏭️ Skipping seeding in production");
      return;
    }

    const defaultPassword = "password123";

    // find existing
    const existing = await User.find(
      { email: { $in: initialUsers.map((u) => u.email) } },
      "email"
    );

    const existingSet = new Set(existing.map((u) => u.email));

    // filter new users
    const newUsers = initialUsers.filter((u) => !existingSet.has(u.email));

    if (newUsers.length === 0) {
      console.log("✅ All initial users already exist");
      return;
    }

    const hashedPassword = await hashPassword(defaultPassword);

    await User.insertMany(
      newUsers.map((u) => ({
        ...u,
        password: hashedPassword,
      }))
    );

    console.log(`✅ Created ${newUsers.length} new users`);
  } catch (err) {
    console.error("❌ Seeding failed:", err.message);
  }
}
