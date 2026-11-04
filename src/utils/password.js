import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function comparePassword(plainPassword, passwordHash) {
  if (!passwordHash) {
    return false;
  }

  return bcrypt.compare(plainPassword, passwordHash);
}
