// Diagnostic script to check admitted dates
// Run this in MongoDB shell or as a Node.js script

import dotenv from "dotenv";
import mongoose from "mongoose";
import Lead from "./models/Lead.js";

dotenv.config();

async function checkAdmittedDates() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Find all admitted leads
    const admittedLeads = await Lead.find({
      status: "Admitted",
      admittedAt: { $exists: true },
    })
      .select("leadId name admittedAt admittedToCourse assignedTo")
      .populate("admittedToCourse", "name")
      .populate("assignedTo", "name")
      .sort({ admittedAt: -1 })
      .limit(50);

    console.log(`\nFound ${admittedLeads.length} admitted leads with dates:\n`);
    console.log(
      "Lead ID".padEnd(20),
      "Name".padEnd(20),
      "Admitted At".padEnd(30),
      "Course".padEnd(30),
      "Assigned To"
    );
    console.log("=".repeat(150));

    for (const lead of admittedLeads) {
      const admittedDate = lead.admittedAt ? new Date(lead.admittedAt) : null;
      const dateStr = admittedDate ? admittedDate.toISOString() : "N/A";
      const localStr = admittedDate
        ? admittedDate.toLocaleString("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        : "N/A";

      console.log(
        lead.leadId.padEnd(20),
        (lead.name || "N/A").padEnd(20).substring(0, 20),
        `${dateStr} (${localStr})`.padEnd(30),
        (lead.admittedToCourse?.name || "N/A").padEnd(30).substring(0, 30),
        lead.assignedTo?.name || "N/A"
      );
    }

    // Check for leads admitted in November 2025
    console.log("\n\n=== NOVEMBER 2025 ADMISSIONS ===");
    const novStart = new Date("2025-11-01T00:00:00.000Z");
    const novEnd = new Date("2025-12-01T00:00:00.000Z");

    const novLeads = await Lead.countDocuments({
      status: "Admitted",
      admittedAt: { $gte: novStart, $lt: novEnd },
    });
    console.log(`Count: ${novLeads}`);

    // Check for leads admitted in December 2025 (shouldn't exist!)
    console.log("\n=== DECEMBER 2025 ADMISSIONS (SHOULD BE ZERO) ===");
    const decStart = new Date("2025-12-01T00:00:00.000Z");
    const decEnd = new Date("2026-01-01T00:00:00.000Z");

    const decLeads = await Lead.find({
      status: "Admitted",
      admittedAt: { $gte: decStart, $lt: decEnd },
    })
      .select("leadId name admittedAt")
      .sort({ admittedAt: 1 });

    console.log(`Count: ${decLeads.length}`);
    if (decLeads.length > 0) {
      console.log(
        "\n⚠️  WARNING: Found leads with FUTURE dates (December 2025):"
      );
      for (const lead of decLeads) {
        console.log(
          `  - ${lead.leadId}: ${lead.name} - Admitted: ${lead.admittedAt}`
        );
      }
    }

    // Check current month (up to today)
    console.log("\n=== CURRENT MONTH (Nov 1 - Today) ===");
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const currentMonthLeads = await Lead.countDocuments({
      status: "Admitted",
      admittedAt: { $gte: currentMonthStart, $lte: now },
    });
    console.log(`Count: ${currentMonthLeads}`);
    console.log(
      `Date range: ${currentMonthStart.toISOString()} to ${now.toISOString()}`
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }
}

checkAdmittedDates();
