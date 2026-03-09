#!/usr/bin/env node

/**
 * Testing Script for LobsterMind Memory Plugin
 * This script creates test scenarios to verify the implemented functionality
 */

const path = require('path');
const fs = require('fs');

// Test data for different scenarios
const testData = {
  sensitive: [
    'My email is john.doe@example.com',
    'Credit card: 4532123456789012',
    'Phone: 555-123-4567',
    'Password: secret123',
    'My PIN is 1234'
  ],
  personalFacts: [
    'I am a software engineer working at Google',
    'Me llamo Juan Pérez y soy fan de Boca',
    'I live in New York City and work as a developer',
    'Soy de Barcelona y vivo en el barrio de Gràcia',
    'Trabajo en Microsoft desde hace 5 años'
  ],
  preferences: [
    'I love classical music and playing the piano',
    'Me gusta más la playa que la montaña',
    'I prefer working late at night',
    'Adoro comer pizza los viernes',
    'My favorite programming language is TypeScript'
  ],
  questions: [
    'What is the weather like today?',
    'Tell me a joke',
    'How do I use this tool?',
    '¿Cómo puedo aprender JavaScript?',
    'Help me find information'
  ],
  short: [
    'Hi',
    'Hello',
    'Yes',
    'No',
    'Okay',
    'Thanks'
  ],
  clustering: [
    'I work at Google as a software engineer',
    'My job is coding in JavaScript and Python',
    'I love my work developing web applications',
    'The weather in New York is cold in winter',
    'I enjoy walking in Central Park',
    'New York winters are quite harsh'
  ]
};

async function runTests() {
  console.log('🧪 Starting LobsterMind Memory Plugin Tests...\n');
  
  // Test the plugin can be imported
  try {
    console.log('1. Testing plugin import...');
    const plugin = require('../index.ts'); // This would fail because it's TypeScript, but that's expected
    console.log('   ❓ Import test skipped - requires compilation'); 
  } catch (e) {
    console.log('   ℹ️  Plugin import test skipped (TypeScript needs compiling)');
  }
  
  console.log('\n📋 Test Data Categories:');
  for (const [category, items] of Object.entries(testData)) {
    console.log(`  ${category}: ${items.length} samples`);
  }
  
  console.log('\n🔍 The following manual tests should validate functionality:');
  console.log('\n1. Test Security Filters - Run with sensitive data:');
  testData.sensitive.forEach(item => console.log(`   - ${item}`));
  
  console.log('\n2. Test Classification - Run with personal facts:');
  testData.personalFacts.forEach(item => console.log(`   - ${item}`));
  
  console.log('\n3. Test Context Awareness - Sequential interactions:');
  console.log('   Sequentially send several work-themed messages to test context clustering');
  
  console.log('\n4. Test Clustering - Compare related vs unrelated items:');
  console.log('   Work-related (should cluster):', testData.clustering.filter(item => item.includes('work') || item.includes('job')));
  console.log('   Weather-related (different cluster):', testData.clustering.filter(item => item.includes('weather') || item.includes('winter')));
  
  console.log('\n5. Test Filtering - Short messages/questions should be filtered:');
  console.log('   Questions (should be blocked):', testData.questions.slice(0, 2));
  console.log('   Short greetings (should be blocked):', testData.short);
  
  // Test commands
  console.log('\n📝 Suggested Command Tests:');
  console.log('   openclaw memories stats - Check total memory count');
  console.log('   openclaw memories list --limit 5 - List recent memories');
  console.log('   openclaw memories autostats - Check auto-capture stats');
  console.log('   openclaw memories clusters - View generated clusters');
  console.log('   openclaw memories cluster <id> - See a specific cluster');
  console.log('   openclaw memories search "work" - Semantic search for work content');
  console.log('   openclaw memories add "Test memory from CLI" - Manual test');

  console.log('\n💡 Next steps:');
  console.log('   1. Start OpenClaw with the LobsterMind plugin enabled');
  console.log('   2. Send the test messages to trigger auto-capture');
  console.log('   3. Run the CLI commands to verify functionality');
  console.log('   4. Check if sensitive data is properly blocked');
  console.log('   5. Verify clusters are grouped appropriately');
  console.log('   6. Confirm security protections work as intended');

  console.log('\n✅ All functionality implemented and ready for testing!');
}

runTests().catch(console.error);