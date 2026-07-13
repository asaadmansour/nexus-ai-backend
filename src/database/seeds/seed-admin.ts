import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { UserRole } from 'src/common/enums/user-role.enum';
import { User } from 'src/users/entities/user.entity';

const DEFAULT_ADMIN_EMAIL = 'admin@nexus-ai.local';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123456';

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const firstName = process.env.ADMIN_FIRST_NAME ?? 'Nexus';
  const lastName = process.env.ADMIN_LAST_NAME ?? 'Admin';
  const phoneNumber = process.env.ADMIN_PHONE_NUMBER ?? null;

  await dataSource.initialize();
  const users = dataSource.getRepository(User);

  const existing = await users.findOne({
    where: { email },
    withDeleted: true,
  });
  const hashedPassword = await bcrypt.hash(password, 10);

  if (existing) {
    existing.firstName = firstName;
    existing.lastName = lastName;
    existing.role = UserRole.ADMIN;
    existing.isEmailVerified = true;
    existing.isIdVerified = true;
    existing.hashedPassword = hashedPassword;
    if (process.env.ADMIN_PHONE_NUMBER !== undefined) {
      existing.phoneNumber = phoneNumber;
    }
    existing.deletedAt = null;
    await users.save(existing);
    console.log(`Admin user updated: ${email}`);
    return;
  }

  const admin = users.create({
    firstName,
    lastName,
    email,
    phoneNumber,
    role: UserRole.ADMIN,
    isEmailVerified: true,
    isIdVerified: true,
    hashedPassword,
  });
  await users.save(admin);
  console.log(`Admin user created: ${email}`);
}

seedAdmin()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
