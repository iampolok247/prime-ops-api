// Migration script to populate missing admittedAt dates
// This will set admittedAt = updatedAt for admitted leads that don't have admittedAt

import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "./models/Lead.js";

dotenv.config();

async function migrateMissingAdmittedDates() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Find admitted leads WITHOUT admittedAt
    const leadsWithoutDate = await Lead.find({
      status: "Admitted",
      $or: [{ admittedAt: { $exists: false } }, { admittedAt: null }],
    });

    console.log(
      `\nFound ${leadsWithoutDate.length} admitted leads without admittedAt field`
    );

    if (leadsWithoutDate.length === 0) {
      console.log(
        "✅ No migration needed - all admitted leads have admittedAt dates"
      );
      return;
    }

    console.log("\n🔧 Migrating leads...\n");

    let updated = 0;
    for (const lead of leadsWithoutDate) {
      // Use updatedAt as fallback, or createdAt if updatedAt doesn't exist
      const fallbackDate = lead.updatedAt || lead.createdAt || new Date();

      console.log(`  ${lead.leadId}: ${lead.name}`);
      console.log(`    Setting admittedAt to: ${fallbackDate.toISOString()}`);

      lead.admittedAt = fallbackDate;
      await lead.save();
      updated++;
    }

    console.log(`\n✅ Migration complete! Updated ${updated} leads`);

    // Verify the fix
    console.log("\n📊 Verification:");
    const novStart = new Date("2025-11-01T00:00:00.000Z");
    const novEnd = new Date("2025-12-01T00:00:00.000Z");
    const novCount = await Lead.countDocuments({
      status: "Admitted",
      admittedAt: { $gte: novStart, $lt: novEnd },
    });
    console.log(`  November 2025 admissions: ${novCount}`);

    const decStart = new Date("2025-12-01T00:00:00.000Z");
    const decCount = await Lead.countDocuments({
      status: "Admitted",
      admittedAt: { $gte: decStart },
    });
    console.log(`  December 2025+ admissions: ${decCount}`);
  } catch (error) {
    console.error("❌ Migration error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }
}

migrateMissingAdmittedDates();
