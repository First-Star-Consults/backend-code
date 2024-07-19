//services.js
import mongoose from "mongoose";



// Consultation schema
// const consultationSchema = new mongoose.Schema({
//   doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
//   patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//   message: { type: String },
//   prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },
// });

const prescriptionSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  medicines: [{
    name: { type: String, required: true },
    dosage: { type: String, required: true }
  }],
});


// Review schema
const reviewSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rating: { type: Number },
  comment: { type: String },
});


// transaction history
const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: false }, // Reference to the Doctor
  consultationSession: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation', required: false }, // Optional, if you have a consultation model
  type: { type: String, required: true }, // e.g., 'payout', 'consultation fee'
  status: { type: String, required: true }, // e.g., 'pending', 'success', 'failed'
  escrowStatus: { type: String, enum: ['held', 'released', 'refunded'], default: null }, // Handles escrow state
  amount: { type: Number, required: true },
  accountNumber: String,
  bankName: String,
  date: { type: Date, default: Date.now },
});

// Notification schema
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' }, // ID of the recipient user
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // ID of the sender (optional)
  type: { type: String, required: true }, // Type of notification, e.g., 'message', 'prescription', 'review'
  message: { type: String, required: true }, // Notification message
  read: { type: Boolean, default: false }, // Indicates if the notification has been read by the recipient
  createdAt: { type: Date, default: Date.now }, // Timestamp for when the notification was created
  relatedObject: {
    type: mongoose.Schema.Types.ObjectId, // Reference to the related object (optional)
    refPath: 'relatedModel',
  },
  relatedModel: {
    type: String, // Model name of the related object (e.g., 'Consultation', 'Prescription')
    enum: ['Consultation', 'Prescription', 'Review', 'Transaction'], // Add other relevant models here
  },
});

// Ensure proper indexing for performance
notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = new mongoose.model('Notification', notificationSchema);




const Transaction = new mongoose.model('Transaction', transactionSchema);
// const Consultation = new mongoose.model("Consultation", consultationSchema);
const Prescription = new mongoose.model("Prescription", prescriptionSchema);
const Reviews = new mongoose.model("Reviews", reviewSchema);



export { Prescription, Reviews, Transaction};