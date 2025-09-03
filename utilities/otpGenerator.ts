import otpGenerator from "otp-generator";

export const generateOTP = (length: number = 6): string => {
  const otp = otpGenerator.generate(length, { 
    upperCaseAlphabets: false, 
    specialChars: false 
  });
  return otp;
};

