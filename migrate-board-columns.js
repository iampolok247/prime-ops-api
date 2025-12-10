/**
 * Migration script to add boardColumn field to existing tasks
 * This ensures all tasks appear in the Kanban board
 */
import mongoose from 'mongoose';
import Task from './models/Task.js';
import dotenv from 'dotenv';

dotenv.config();

async function migrateBoardColumns() {
  try {
    console.log('🔄 Connecting to database...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: 'primeops'
    });
    console.log('✅ Connected to database');

    // Find all tasks that don't have a boardColumn field
    const tasksWithoutBoardColumn = await Task.find({
      $or: [
        { boardColumn: { $exists: false } },
        { boardColumn: null }
      ]
    });

    console.log(`📊 Found ${tasksWithoutBoardColumn.length} tasks without boardColumn`);

    if (tasksWithoutBoardColumn.length === 0) {
      console.log('✨ All tasks already have boardColumn field. Nothing to migrate.');
      await mongoose.connection.close();
      process.exit(0);
    }

    let updated = 0;
    let errors = 0;

    for (const task of tasksWithoutBoardColumn) {
      try {
        // Map status to boardColumn
        // If status doesn't exist, default to 'To Do'
        const statusToBoardColumn = {
          'To Do': 'To Do',
          'In Progress': 'In Progress',
          'In Review': 'In Review',
          'Completed': 'Completed'
        };

        const boardColumn = statusToBoardColumn[task.status] || 'To Do';
        
        console.log(`  Updating task ${task._id}: ${task.title}`);
        console.log(`    Status: ${task.status} → Board Column: ${boardColumn}`);

        await Task.updateOne(
          { _id: task._id },
          { 
            $set: { 
              boardColumn: boardColumn,
              boardPosition: task.boardPosition || 0
            }
          }
        );

        updated++;
      } catch (error) {
        console.error(`  ❌ Error updating task ${task._id}:`, error.message);
        errors++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`  ✅ Successfully updated: ${updated} tasks`);
    console.log(`  ❌ Errors: ${errors} tasks`);
    console.log('✨ Migration completed!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

migrateBoardColumns();
