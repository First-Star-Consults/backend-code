//authcontroller
import crypto from 'crypto';
import passport from "passport";
import User from "../models/user.js";
import { Doctor, Therapist, Pharmacy, Laboratory } from "../models/healthProviders.js"
import determineRole from "../utils/determinUserRole.js";
// import { sendVerificationEmail } from "../utils/nodeMailer.js";
import { generateVerificationCode } from "../utils/verficationCodeGenerator.js";
import { generateSessionToken } from '../models/user.js';
import { chargePatient, verifyTransaction, initiateTransfer, createTransferRecipient } from "../config/paymentService.js";
import { Transaction } from "../models/services.js";

//i am wondering why am getting 500 when i from heroku

const verificationcode = generateVerificationCode()


const authController = {

  register: async (req, res) => {
    try {
      const { userType, email, password, phone, firstName, lastName } = req.body;

      const role = determineRole(userType);

      // Create a new user instance
      const newUser = new User({
        username: email,
        email,
        firstName,
        lastName,
        role: role,
        phone,
        verificationcode,
      });

      // Choose the appropriate model based on userType
      let healthProviderModel;
      switch (userType) {
        case 'doctor':
          healthProviderModel = Doctor;
          break;
        case 'pharmacy':
          healthProviderModel = Pharmacy;
          break;
        case 'therapist':
          healthProviderModel = Therapist;
          break;
        case 'laboratory':
          healthProviderModel = Laboratory;
          break;
        // Add other cases as needed
        default:
          // Default to patient
          healthProviderModel = null;
      }

      // Create a new health provider instance if userType is one of the specified types
      let healthProvider;
      if (healthProviderModel) {
        healthProvider = new healthProviderModel({
          // Add fields specific to health providers
          name: role, // Example field; replace with actual fields
        });
      }

      await User.register(newUser, password, async (err, user) => {
        if (err) {
          // Handle registration errors
          console.error(err);
          if (err.name === 'UserExistsError') {
            return res.status(400).json({ message: 'User already registered' });
          } else {
            console.error(err);
            return res.status(500).json({ message: 'Internal Server Error' });
          }
        } else {
          // If a health provider was created, associate it with the user
          if (healthProvider) {
            healthProvider._id = user._id; // Set the health provider's _id to match the user's _id
            user.healthProvider = healthProvider._id;
            await healthProvider.save();
          }

          // Send verification code via email
          // await sendVerificationEmail(user.email, verificationcode);

          passport.authenticate('local')(req, res, () => {
            // Redirect to verify route
            res.status(200).json({ message: `Verification code: ${verificationcode}`, redirectTo: "/verify" });
          });
        }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Unexpected error during registration' });
    }
  },



  login: async (req, res) => {
    const user = new User({
      username: req.body.email,
      password: req.body.password
    });

    req.login(user, async (err) => {
      if (err) {
        console.log(err);
      } else {
        passport.authenticate("local", (err, user, info) => {
          if (err) {
            console.log(err);
            return res.status(500).json({ message: 'Internal Server Error' });
          }

          if (!user) {
            return res.status(401).json({ message: 'Authentication failed' });
          }

          req.logIn(user, async (err) => {
            if (err) {
              console.log(err);
              return res.status(500).json({ message: 'Internal Server Error' });
            }

            // Generate session token if the user is a doctor
            let sessionToken = null;
            if (user.role === 'doctor') {
              const doctor = await Doctor.findById(user._id);
              if (doctor) {
                sessionToken = generateSessionToken();
                doctor.sessionToken = sessionToken;
                await doctor.save();
              }
            }

            // Prepare the response data
            const responseData = {
              message: 'Successfully logged in',
              user: {
                profilePhoto: user.profilePhoto,
                firstName: user.firstName,
                lastName: user.lastName,
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                isVerified: { status: user.isVerified, message: "Alabo, this one na for email verification o" },
              },
            };

            // Add sessionToken to the response if available
            if (sessionToken) {
              responseData.user.sessionTokenInfo = {
                token: sessionToken,
                message: "I won use dis one like a logic to know doctors that are online"
              };
            }

            // Include kycVerification for health providers
            if (['doctor', 'therapist', 'pharmacy', 'laboratory'].includes(user.role)) {
              let healthProviderInfo = null;
              switch (user.role) {
                case 'doctor':
                  healthProviderInfo = await Doctor.findById(user._id);
                  break;
                case 'therapist':
                  healthProviderInfo = await Therapist.findById(user._id);
                  break;
                case 'pharmacy':
                  healthProviderInfo = await Pharmacy.findById(user._id);
                  break;
                case 'laboratory':
                  healthProviderInfo = await Laboratory.findById(user._id);
                  break;
              }

              if (healthProviderInfo && healthProviderInfo.kycVerification !== undefined) {
                responseData.user.kycVerification = healthProviderInfo.kycVerification;
              }
            }

            res.status(201).json(responseData);
          });
        })(req, res);
      }
    });
  },


  logout: async function (req, res) {
    // Check if the user is authenticated
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
      // Clear session token for doctor if user is a doctor
      if (req.user.role === 'doctor') {
        const doctor = await Doctor.findById(req.user._id);
        if (doctor) {
          doctor.sessionToken = null;
          await doctor.save();
        }
      }

      // Logout the user
      req.logout((err) => {
        if (err) {
          console.log(err);
        } else {
          res.status(200).json({ message: "Successfully logged out" });
        }
      });
    } catch (error) {
      console.error('Error during logout:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },



  // Verify 
  verify: async (req, res) => {
    try {
      const verifyCode = req.body.verifyCode;


      // Check if the user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Check if the user is already verified
      if (req.user.isVerified) {
        return res.status(400).json({ message: 'User is already verified' });
      }

      console.log(req.user.verificationcode, verifyCode);
      // Check if the verification code matches the one in the database
      if (req.user.verificationcode !== verifyCode) {
        return res.status(400).json({ message: 'Invalid verification code' });
      }



      // Update user's verification status
      req.user.isVerified = true;
      req.user.verificationcode = null; //clear the code after successful verification
      await req.user.save();

      // Return information to populate dashboard
      return res.status(201).json({
        message: 'Email Verified Successfully, you can login into your account now'

      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: 'Unexpected error during verification' });
    }
  },



  fundWallet: async (req, res) => {
    const { amount } = req.body; // Only get amount from the request body

    try {
      const userId = req.params.userId
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const email = user.email; // Get email from the user model

      const authorizationUrl = await chargePatient(email, amount);
      if (authorizationUrl) {
        // Directly send the authorization URL to the client
        res.status(200).json({ success: true, authorizationUrl });
      } else {
        throw new Error('Unable to initiate wallet funding');
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: error.toString() });
    }
  },



  handlePaystackWebhook: async (req, res) => {
    try {
      const event = req.body;
  
      // Verify Paystack webhook signature to ensure the request is legitimate
      const secret = process.env.PAYSTACK_SECRET_KEY;
      const hash = crypto.createHmac('sha512', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (req.headers['x-paystack-signature'] !== hash) {
        return res.status(401).send('Invalid signature');
      }
  
      // Handle the successful payment event
      if (event.event === 'charge.success') {
        const reference = event.data.reference;
        const verificationResult = await verifyTransaction(reference);
  
        if (verificationResult.success) {
          // Extract email and amount from the verified transaction
          const email = verificationResult.data.customer.email;
          const amount = verificationResult.data.amount / 100; // Convert from kobo to naira
  
          // Find the user by email and update their wallet balance
          const user = await User.findOne({ email: email });
          if (user) {
            user.walletBalance += amount; // Increase the user's wallet balance
            await user.save();
  
            // Record the successful transaction
            const transaction = new Transaction({
              user: user._id,
              type: 'wallet funding',
              amount: amount,
              status: 'success',
              date: new Date()
            });
            await transaction.save();
  
            res.status(200).send('Wallet funded and transaction recorded successfully');
          } else {
            console.error('User not found for email:', email);
            res.status(404).json({ message: 'User not found' });
          }
        } else {
          console.error('Payment verification failed:', verificationResult.message);
          res.status(500).json({ message: 'Payment verification failed' });
        }
      } else {
        res.status(200).send('Webhook received but not a charge.success event');
      }
    } catch (error) {
      console.error('Error handling Paystack webhook:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },

  // Add a transaction
  addTransaction: async (userId, type, amount, status) => {
    const transaction = new Transaction({
      user: userId,
      type,
      amount,
      status,
    });

    await transaction.save();
  },

  // Update wallet balance
  updateWalletBalance: async (userId, amount, isCredit) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.walletBalance += isCredit ? amount : -amount;
    await user.save();
  },

  getTransactionHistory: async (req, res) => {
    try {
      const { userId } = req.params; 
  
      const transactions = await Transaction.find({ user: userId }).sort({ date: -1 }); 
      res.status(200).json({ success: true, transactions });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
  
  getWalletBalance: async (req, res) => {
    try {
      const { userId } = req.params; // Assuming you pass userId as a URL parameter
  
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
  
      res.status(200).json({ success: true, walletBalance: user.walletBalance });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Function to create a withdrawal request
withdraw: async (req, res) => {
  try {
    const userId = req.params.userId;
    const { amount, accountNumber, bankName } = req.body;

     // This is where you'd call the bank's API
    // The specifics depend on the bank's API documentation
//     const response = await someBankingAPI.verifyAccount({ accountNumber, bankCode });
//     return response.isValid;
//   } catch (error) {
//     console.error('Error verifying bank account:', error);
//     return false;
//   }
// }

    // Check if the user exists and has the appropriate role
    const user = await User.findById(userId);
    if (!user || !['doctor', 'laboratory', 'therapist', 'pharmacist'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized! You are not a health provider' });
    }

    // Check if the wallet has enough balance
    if (user.walletBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Create a pending transaction with account details
    const transaction = new Transaction({
      user: userId,
      type: 'withdrawal',
      status: 'pending',
      amount: amount,
      accountNumber: accountNumber, // Saved for when the admin processes the withdrawal
      bankName: bankName, // Saved as additional info for admin or for withdrawal processing
    });

    await transaction.save();

    // Here, you can notify the admin for approval...

    res.status(200).json({ success: true, message: 'Withdrawal request created and pending approval' });
  } catch (error) {
    console.error('Error during withdrawal:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
},


// Function to approve a withdrawal request by Admin
approveWithdrawal: async (req, res) => {
  try {
    const adminId = req.params.adminId; 
    const { transactionId, accountNumber, bankCode } = req.body; 

    // Validate admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized to perform this action' });
    }

    // Find the transaction and validate it
    const transaction = await Transaction.findById(transactionId);
    if (!transaction || transaction.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invalid or already processed transaction' });
    }

    // Find the user who requested the withdrawal
    const user = await User.findById(transaction.user);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Create a transfer recipient
    const recipientDetails = await createTransferRecipient(user.firstName + ' ' + user.lastName, accountNumber, bankCode);
    if (!recipientDetails) {
      transaction.status = 'failed';
      await transaction.save();
      return res.status(500).json({ success: false, message: 'Failed to create transfer recipient' });
    }

    // Initiate the transfer
    const transferResponse = await initiateTransfer(transaction.amount, recipientDetails.recipient_code);
    if (!transferResponse) {
      transaction.status = 'failed';
      await transaction.save();
      return res.status(500).json({ success: false, message: 'Failed to initiate transfer' });
    }

    // If transfer initiation is successful, deduct the amount from user's wallet balance and mark the transaction as succeeded
    user.walletBalance -= transaction.amount;
    transaction.status = 'success';
    await user.save();
    await transaction.save();

    res.status(200).json({ success: true, message: 'Withdrawal approved and processed', transferDetails: transferResponse });
  } catch (error) {
    console.error('Error during withdrawal approval:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
},

getPendingWithdrawals: async (req, res) => {
  try {
    const adminId = req.params.adminId; // or req.user._id if you have the user ID stored in req.user

    // Validate admin privileges
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized to perform this action' });
    }

    // Retrieve all pending withdrawal transactions
    const pendingWithdrawals = await Transaction.find({ status: 'pending', type: 'withdrawal' }).populate('user', 'firstName lastName email');

    res.status(200).json({ success: true, pendingWithdrawals });
  } catch (error) {
    console.error('Error fetching pending withdrawals:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
},



};

export default authController;