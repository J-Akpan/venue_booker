import bcrypt from 'bcryptjs';

export const encryptPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    return hashedPassword;
}

export const comparePassword = async (password: string, hashed: string) =>{
    const compare = bcrypt.compare(password, hashed)
    return compare;
}