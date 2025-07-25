// utils/transactionStatusChecker.js
import { Transaction } from '../models/services.js';
import { checkTransferStatus } from '../config/paymentService.js';
import User from '../models/user.js';
import { sendNotificationEmail } from '../utils/nodeMailer.js';
import notificationController from '../controllers/notificationController.js';
import mongoose from 'mongoose';

/**
 * Checks the status of transactions marked as 'verification_needed' with Paystack
 * and updates their status accordingly.
 */
export const checkPendingTransactions = async () => {
  try {
    console.log('Starting scheduled check for verification_needed transactions...');
    
    // Check if MongoDB connection is ready
    if (mongoose.connection.readyState !== 1) {
      console.log('MongoDB connection is not ready. Current state:', mongoose.connection.readyState);
      console.log('Skipping transaction check until connection is restored.');
      return;
    }
    
    // Set a global timeout for the entire operation
    const operationTimeout = setTimeout(() => {
      console.log('Transaction check operation timed out after 25 seconds');
      // This will not stop the operation but will log that it timed out
    }, 25000);
    
    // Find all transactions that need verification with a timeout option
    const pendingTransactions = await Transaction.find({ 
      status: 'verification_needed',
      transferCode: { $exists: true, $ne: null } // Only check transactions with a transferCode
    })
    .populate('user')
    .lean() // Use lean() for better performance when you don't need Mongoose document methods
    .maxTimeMS(5000); // Set a 5-second timeout for this query
    
    console.log(`Found ${pendingTransactions.length} transactions needing verification`);
    
    // Process each transaction
    for (const transaction of pendingTransactions) {
      try {
        console.log(`Checking transaction ${transaction._id} with transferCode ${transaction.transferCode}`);
        
        // Check the status with Paystack
        const transferStatus = await checkTransferStatus(transaction.transferCode);
        
        if (!transferStatus.success) {
          console.log(`Failed to check status for transaction ${transaction._id}: ${transferStatus.message}`);
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { $set: { notes: `${transaction.notes || ''} | Auto-check failed: ${transferStatus.message}` } },
            { maxTimeMS: 5000 } // Set timeout for this operation
          );
          continue;
        }
        
        const paystackStatus = transferStatus.data.status;
        const notes = `${transaction.notes || ''} | Auto-check result: ${paystackStatus}`;
        
        // If Paystack confirms the transfer was successful
        if (paystackStatus === 'success') {
          const user = transaction.user;
          
          if (!user) {
            console.log(`User not found for transaction ${transaction._id}`);
            await Transaction.findByIdAndUpdate(
              transaction._id,
              { $set: { notes: `${notes} | User not found during auto-check` } },
              { maxTimeMS: 5000 }
            );
            continue;
          }
          
          // Deduct balance if not already deducted - use findOneAndUpdate for atomicity
          const updatedUser = await User.findOneAndUpdate(
            { _id: user._id, walletBalance: { $gte: transaction.amount } },
            { $inc: { walletBalance: -transaction.amount } },
            { new: true, maxTimeMS: 5000 }
          );
          
          if (!updatedUser) {
            console.log(`Failed to update user balance for transaction ${transaction._id}`);
          }
          
          // Update transaction status
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { 
              $set: {
                status: 'success',
                completedAt: new Date(),
                notes: notes
              }
            },
            { maxTimeMS: 5000 }
          );
          
          // Send success notification
          try {
            await sendNotificationEmail(
              user.email,
              'Withdrawal Successful',
              `Your withdrawal of ₦${transaction.amount} to ${transaction.bankName} (${transaction.accountNumber}) has been completed successfully.`
            );
          } catch (emailError) {
            console.error('Error sending notification email:', emailError);
          }
          
          // Create in-app notification
          try {
            await notificationController.createNotification(
              user._id,
              null,
              'withdrawal',
              `Your withdrawal of ₦${transaction.amount} to ${transaction.bankName} (${transaction.accountNumber}) has been completed successfully.`,
              transaction._id,
              'Transaction'
            );
          } catch (notificationError) {
            console.error('Error creating notification:', notificationError);
          }
          
          console.log(`Transaction ${transaction._id} verified as successful and updated`);
        } 
        // If Paystack confirms the transfer failed
        else if (paystackStatus === 'failed') {
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { $set: { status: 'failed', notes: notes } },
            { maxTimeMS: 5000 }
          );
          console.log(`Transaction ${transaction._id} verified as failed and updated`);
        }
        // For other statuses (pending, etc.), keep as verification_needed
        else {
          await Transaction.findByIdAndUpdate(
            transaction._id,
            { $set: { notes: notes } },
            { maxTimeMS: 5000 }
          );
          console.log(`Transaction ${transaction._id} status is ${paystackStatus}, keeping as verification_needed`);
        }
      } catch (error) {
        console.error(`Error processing transaction ${transaction._id}:`, error);
      }
    }
    
    console.log('Completed scheduled check for verification_needed transactions');
    
    // Clear the operation timeout
    clearTimeout(operationTimeout);
  } catch (error) {
    console.error('Error in checkPendingTransactions:', error);
    // Clear the operation timeout even if there was an error
    if (typeof operationTimeout !== 'undefined') {
      clearTimeout(operationTimeout);
    }
  }
};

/**
 * Sets up a recurring check for pending transactions
 * @param {number} intervalMinutes - How often to check (in minutes)
 */
export const setupTransactionStatusChecker = (intervalMinutes = 30) => {
  console.log(`Setting up transaction status checker to run every ${intervalMinutes} minutes`);
  
  // Run after a short delay to ensure database connection is established
  setTimeout(() => {
    checkPendingTransactions();
    
    // Then set up recurring check
    const intervalMs = intervalMinutes * 60 * 1000;
    return setInterval(checkPendingTransactions, intervalMs);
  }, 10000); // 10-second delay before first run
};