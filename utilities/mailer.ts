import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();


// 1. Create transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // or your SMTP server
  port: 587,
  secure: false, // true for 465, false for 587
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // your app password (not regular password)
  },
});

// 2. Send email
export const sendMail = async (to: string, subject: string, text: string, html?: string) => {
  await transporter.sendMail({
    from: `"Venue Booker" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
  return true;
};
