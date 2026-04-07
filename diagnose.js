// Comprehensive diagnostic tool
const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('RFID System Diagnostic Tool');
console.log('='.repeat(60) + '\n');

const issues = [];
const warnings = [];

// 1. Check Node.js version
console.log('1. Environment Check');
const nodeVersion = process.version;
console.log(`   Node.js version: ${nodeVersion}`);
if (parseInt(nodeVersion.split('.')[0].substring(1)) < 14) {
  issues.push('Node.js version should be 14 or higher');
}

// 2. Check if dependencies are installed
console.log('\n2. Dependency Check');
const checkDependency = (dir, name) => {
  const nodeModulesPath = path.join(__dirname, dir, 'node_modules');
  if (fs.existsSync(nodeModulesPath)) {
    console.log(`   ✅ ${name} dependencies installed`);
    return true;
  } else {
    console.log(`   ❌ ${name} dependencies missing`);
    issues.push(`${name} dependencies not installed. Run: cd ${dir} && npm install`);
    return false;
  }
};

const backendDeps = checkDependency('.', 'Backend');
const clientDeps = checkDependency('client', 'Client');

// 3. Check critical dependencies
console.log('\n3. Critical Dependencies Check');
const checkCriticalDep = (dir, dep, name) => {
  const depPath = path.join(__dirname, dir, 'node_modules', dep);
  if (fs.existsSync(depPath)) {
    console.log(`   ✅ ${name} found`);
    return true;
  } else {
    console.log(`   ❌ ${name} missing`);
    warnings.push(`${name} not found in ${dir}`);
    return false;
  }
};

if (backendDeps) {
  checkCriticalDep('.', 'express', 'Express');
  checkCriticalDep('.', 'serialport', 'SerialPort');
  checkCriticalDep('.', 'ws', 'WebSocket (ws)');
  checkCriticalDep('.', 'sqlite3', 'SQLite3');
}

if (clientDeps) {
  checkCriticalDep('client', 'react', 'React');
  checkCriticalDep('client', 'react-router-dom', 'React Router');
  checkCriticalDep('client', 'axios', 'Axios');
}

// 4. Check port availability (basic check)
console.log('\n4. Port Check');
console.log('   Backend should run on port 5000');
console.log('   Frontend should run on port 3000');
console.log('   ⚠️  If ports are in use, you may need to stop other applications');

// 5. Check database file
console.log('\n5. Database Check');
const dbPath = path.join(__dirname, 'server', 'database', 'cards.db');
if (fs.existsSync(dbPath)) {
  console.log('   ✅ Database file exists');
} else {
  console.log('   ℹ️  Database will be created on first run');
}

// 6. Check for common configuration issues
console.log('\n6. Configuration Check');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('   ℹ️  .env file not found (optional, will use defaults)');
} else {
  console.log('   ✅ .env file exists');
}

// 7. Check file permissions
console.log('\n7. File Permissions Check');
try {
  fs.accessSync(__dirname, fs.constants.W_OK);
  console.log('   ✅ Write permissions OK');
} catch (error) {
  issues.push('No write permissions in project directory');
  console.log('   ❌ Write permissions issue');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));

if (issues.length === 0 && warnings.length === 0) {
  console.log('✅ No issues found! System appears ready to run.');
  console.log('\nTo start the application:');
  console.log('  npm run dev');
} else {
  if (issues.length > 0) {
    console.log(`\n❌ CRITICAL ISSUES (${issues.length}):`);
    issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  WARNINGS (${warnings.length}):`);
    warnings.forEach((warning, i) => {
      console.log(`   ${i + 1}. ${warning}`);
    });
  }
  
  console.log('\nRecommended actions:');
  if (issues.some(i => i.includes('dependencies'))) {
    console.log('   1. Install dependencies: npm run install-all');
  }
  if (issues.some(i => i.includes('permissions'))) {
    console.log('   2. Check file permissions or run as administrator');
  }
}

console.log('\n' + '='.repeat(60));
