const mongoose = require('mongoose');
const UserModule = require('./dist/models/User');

const User = UserModule.default || UserModule;
const UserRole = UserModule.UserRole || { SUPER_ADMIN: 'super_admin' };
const UserStatus = UserModule.UserStatus || { ACTIVE: 'active' };

async function main() {
  const mongoUri = process.env.MONGO_URI;
  const username = process.env.SUPER_ADMIN_USERNAME || 'admin';
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@autoark.com';
  const syncExisting = process.env.SUPER_ADMIN_SYNC === 'true';

  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }
  if (!password) {
    throw new Error('SUPER_ADMIN_PASSWORD is required');
  }

  await mongoose.connect(mongoUri);

  const existingByName = await User.findOne({ username }).select('+password');
  if (existingByName) {
    if (syncExisting) {
      existingByName.password = password;
      existingByName.email = email;
      existingByName.role = UserRole.SUPER_ADMIN;
      existingByName.status = UserStatus.ACTIVE;
      await existingByName.save();
      console.log(`Super admin synced: ${username}`);
    } else {
      console.log(`Super admin already exists: ${username}`);
    }
    await mongoose.connection.close();
    return;
  }

  const existingSuperAdmin = await User.findOne({ role: UserRole.SUPER_ADMIN }).lean();
  if (existingSuperAdmin && !syncExisting) {
    console.log('A super admin already exists; set SUPER_ADMIN_SYNC=true to sync by username.');
    await mongoose.connection.close();
    return;
  }

  await User.create({
    username,
    password,
    email,
    role: UserRole.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
  });
  console.log(`Super admin created: ${username}`);
  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
