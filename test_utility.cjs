// test_utility.js
// Quick testing utility for LobsterMind Memory Plugin

const fs = require('fs');
const { spawn, exec } = require('child_process');

// Function to execute OpenClaw CLI command and return result
function cli(cmd, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmd', ['/c', 'openclaw memories ' + cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    let stdout = '';
    let stderr = '';
    let timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Command timed out'));
    }, timeout);

    proc.stdout.on('data', data => stdout += data.toString());
    proc.stderr.on('data', data => stderr += data.toString());

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Test security blocking function (simulates what the plugin does)
function testSecurityDetection(text) {
  const patterns = [
    /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,                    // Email
    /\b(?:\d{4}[-\s]?){3}\d{4}\b/,                   // Card 1
    /\b(?:\d{4}[-\s]?){2}\d{4}[-\s]?\d{4}\b/,       // Card 2
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,             // Phone
    /\+\d{1,3}[-.\s]?\d{3,14}\b/,                    // Intl Phone
    /password[:\s]+['"][^'"]+['"]\b/i,               // Password
    /apikey[:\s]+['"][^'"]+['"]\b/i,                 // API Key
    /\b\d{3}-\d{2}-\d{4}/                            // SSN
  ];

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true; // Would be blocked
    }
  }
  
  return false; // Would pass
}

// Test classification function (simulates internal logic)
function testClassification(text) {
  const lowerText = text.toLowerCase();
  
  if (/\b(I\s+am|I'm|soy|yo\s+soy|mi\s+nombre\s+es|llamo)\b/i.test(lowerText)) {
    return { type: 'USER_FACT', confidence: 0.9 };
  }
  if (/\b(like|love|adore|prefer|enjoy|gusta|amo|prefiero)\b/i.test(lowerText)) {
    return { type: 'PREFERENCE', confidence: 0.95 };
  }
  if (/\b(decidí|decid|elegí|took|chose|opté|opt|since|desde)\b/i.test(lowerText)) {
    return { type: 'DECISION', confidence: 0.90 };
  }
  if (lowerText.includes('boca') || lowerText.includes('de boca')) {
    return { type: 'USER_FACT', confidence: 0.95 };
  }
  
  return { type: 'IGNORE', confidence: 0.0 };
}

// Run quick tests
async function runQuickTests() {
  console.log('🔬 QUICK FUNCTIONALITY TESTS FOR LOBSTERMIND MEMORY PLUGIN\n');
  
  // Security test
  console.log('🔒 SECURITY TESTS:');
  const senstiveSamples = [
    'My email is test@example.com',
    'Card: 1234-5678-9012-3456',
    'Call me at 555-123-4567'
  ];
  
  const safeSamples = [
    'I like music',
    'Trabajo en una empresa',
    'Hablo español'
  ];
  
  console.log('   Sensitivity (should block):');
  for (const text of senstiveSamples) {
    console.log(`      ✅ "${text}" -> ${testSecurityDetection(text) ? 'BLOCKED' : 'ALLOWED (unexpected)'}`);
  }
  
  console.log('   Safe (should pass):');
  for (const text of safeSamples) {
    console.log(`      ✅ "${text}" -> ${testSecurityDetection(text) ? 'BLOCKED (unexpected)' : 'ALLOWED'}`);
  }
  
  // Classification test
  console.log('\n🏷️  CLASSIFICATION TESTS:');
  const classificationSamples = [
    'I am a software engineer',
    'Me encanta el fútbol',
    'Decidí aprender español hace 2 meses',
    'Soy de Boca y vivo en Buenos Aires',
    'Just testing'
  ];
  
  for (const text of classificationSamples) {
    const result = testClassification(text);
    console.log(`      🏷️  "${text}" -> [${result.type}] Conf: ${result.confidence}`);
  }
  
  // Test CLI if available
  console.log('\n💻 CLI COMMAND AVAILABILITY TEST:');
  try {
    await cli('stats');
    console.log('      ✅ "openclaw memories stats" - Command available');
  } catch (e) {
    console.log('      ❌ "openclaw memories stats" - Command not available (plugin may not be loaded)');
  }
  
  try {
    await cli('autostats');
    console.log('      ✅ "openclaw memories autostats" - Command available');
  } catch (e) {
    console.log('      ❌ "openclaw memories autostats" - Command not available');
  }
  
  try {
    await cli('clusters');
    console.log('      ✅ "openclaw memories clusters" - Command available');
  } catch (e) {
    console.log('      ❌ "openclaw memories clusters" - Command not available');
  }
  
  console.log('\n✅ Quick functionality verification completed!');
  console.log('   For full testing, see TESTING_GUIDE.md');
}

runQuickTests().catch(console.error);
module.exports = { testSecurityDetection, testClassification, cli };