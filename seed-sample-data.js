import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Lead from './models/Lead.js';
import AdmissionFee from './models/AdmissionFee.js';

dotenv.config();

(async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    
    // Get users
    const admissionUser = await User.findOne({ role: 'Admission' });
    const dmUser = await User.findOne({ role: 'DigitalMarketing' });
    
    if (!admissionUser || !dmUser) {
      console.log('❌ Required users not found. Run npm run seed first.');
      process.exit(1);
    }

    console.log('✅ Found users');
    
    // Create sample admitted leads
    const leads = [
      {
        leadId: 'LEAD-2025-0001',
        name: 'Arif Rahman',
        phone: '+8801711223344',
        email: 'arif.rahman@example.com',
        interestedCourse: 'Graphics Design Professional',
        status: 'Admitted',
        source: 'Meta Lead',
        assignedBy: dmUser._id,
        assignedTo: admissionUser._id,
        admittedAt: new Date('2025-11-01'),
        counselingAt: new Date('2025-10-28')
      },
      {
        leadId: 'LEAD-2025-0002',
        name: 'Tasnim Jahan',
        phone: '+8801812334455',
        email: 'tasnim.jahan@example.com',
        interestedCourse: 'Web Development',
        status: 'Admitted',
        source: 'LinkedIn Lead',
        assignedBy: dmUser._id,
        assignedTo: admissionUser._id,
        admittedAt: new Date('2025-11-05'),
        counselingAt: new Date('2025-11-02')
      },
      {
        leadId: 'LEAD-2025-0003',
        name: 'Mehedi Hasan',
        phone: '+8801913445566',
        email: 'mehedi.hasan@example.com',
        interestedCourse: 'Digital Marketing',
        status: 'Admitted',
        source: 'Manually Generated Lead',
        assignedBy: dmUser._id,
        assignedTo: admissionUser._id,
        admittedAt: new Date('2025-11-10'),
        counselingAt: new Date('2025-11-08')
      },
      {
        leadId: 'LEAD-2025-0004',
        name: 'Fatima Akter',
        phone: '+8801522334455',
        email: 'fatima.akter@example.com',
        interestedCourse: 'UI/UX Design',
        status: 'In Follow Up',
        source: 'Meta Lead',
        assignedBy: dmUser._id,
        assignedTo: admissionUser._id,
        assignedAt: new Date('2025-11-10'),
        counselingAt: new Date('2025-11-12'),
        nextFollowUpDate: new Date('2025-11-16'), // Due today
        followUps: [{
          note: 'Interested but wants to discuss payment plan',
          at: new Date('2025-11-12'),
          by: admissionUser._id
        }]
      },
      {
        leadId: 'LEAD-2025-0005',
        name: 'Sabbir Hossain',
        phone: '+8801633445566',
        email: 'sabbir.hossain@example.com',
        interestedCourse: 'Python Programming',
        status: 'Counseling',
        source: 'LinkedIn Lead',
        assignedBy: dmUser._id,
        assignedTo: admissionUser._id,
        assignedAt: new Date('2025-11-08'),
        counselingAt: new Date('2025-11-10'),
        nextFollowUpDate: new Date('2025-11-15'), // Overdue
        followUps: [{
          note: 'Completed demo class, needs time to decide',
          at: new Date('2025-11-10'),
          by: admissionUser._id
        }]
      }
    ];

    // Clear existing sample data (optional)
    await Lead.deleteMany({ leadId: { $in: leads.map(l => l.leadId) } });
    
    const createdLeads = await Lead.insertMany(leads);
    console.log(`✅ Created ${createdLeads.length} sample leads (${leads.length - 3} with follow-ups)`);

    // Create sample admission fees
    const fees = [
      {
        lead: createdLeads[0]._id,
        courseName: 'Graphics Design Professional',
        totalAmount: 25000,
        amount: 10000,
        dueAmount: 15000,
        method: 'Bkash',
        paymentDate: new Date('2025-11-01'),
        nextPaymentDate: new Date('2025-11-16'), // Due today
        note: 'First installment - payment due today',
        status: 'Approved',
        submittedBy: admissionUser._id
      },
      {
        lead: createdLeads[1]._id,
        courseName: 'Web Development',
        totalAmount: 30000,
        amount: 15000,
        dueAmount: 15000,
        method: 'Bank Transfer',
        paymentDate: new Date('2025-11-05'),
        nextPaymentDate: new Date('2025-11-25'),
        note: 'Paid 50% upfront, remaining due by end of November',
        status: 'Approved',
        submittedBy: admissionUser._id
      },
      {
        lead: createdLeads[2]._id,
        courseName: 'Digital Marketing',
        totalAmount: 20000,
        amount: 5000,
        dueAmount: 15000,
        method: 'Nagad',
        paymentDate: new Date('2025-11-10'),
        nextPaymentDate: new Date('2025-11-15'),
        note: 'Small initial payment - overdue for follow-up',
        status: 'Approved',
        submittedBy: admissionUser._id
      }
    ];

    await AdmissionFee.deleteMany({ lead: { $in: createdLeads.map(l => l._id) } });
    const createdFees = await AdmissionFee.insertMany(fees);
    console.log(`✅ Created ${createdFees.length} sample admission fees`);

    console.log('\n📊 Sample Data Summary:');
    console.log('  - 5 Leads (3 Admitted, 2 In Follow Up/Counseling)');
    console.log('  - 3 Approved Admission Fees with Due Amounts');
    console.log('  - Payment Notifications:');
    console.log('    • 1 Overdue payment (Mehedi Hasan - Nov 15)');
    console.log('    • 1 Due TODAY (Arif Rahman - Nov 16)');
    console.log('    • 1 Upcoming payment (Tasnim - Nov 25)');
    console.log('  - Follow-up Notifications:');
    console.log('    • 1 Overdue follow-up (Sabbir - Nov 15)');
    console.log('    • 1 Due TODAY follow-up (Fatima - Nov 16)');
    console.log('\n✅ Sample data created successfully!');
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Seed error:', e.message);
    process.exit(1);
  }
})();
