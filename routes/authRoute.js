import passport from "passport";
import express from "express";
import authController from "../controllers/authController.js";



const router = express.Router();

// Welcome message
router.get("/", (req, res) => {
  res.json({ message: "Welcome to Mobile Doctor authentication" });
});

// Google authentication
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile"] })
);

router.get(
  "/google/user",
  passport.authenticate("google", { failureRedirect: "/" }),
  function (req, res) {
    // Successful authentication.
    res.status(200).json({ message: "Successfully logged in with Google Auth" });
  }
);

// Logout route
router.get("/logout", authController.logout);


// Registration and login routes
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/verify", authController.verify);

export default router;
