/** 
 * POL Token Bridge - Sepolia ↔ Amoy
 * 
 * This application enables bridging POL tokens between:
 * - Ethereum Sepolia (Layer 1 testnet) 
 * - Polygon Amoy (Layer 2 testnet)
 * 
 * Features:
 * - Deposit: Sepolia → Amoy (25 minutes)
 * - Withdraw: Amoy → Sepolia (90-180 minutes + exit processing)
 * - Custom amounts for both operations
 * - Automatic checkpoint detection and exit processing
 * - Manual step-by-step control options
 * 
 * @format 
 */

// Load environment variables from .env file
require('dotenv').config();

// Import required libraries
const ethers = require('ethers');                        // Ethereum interaction library
const rootChainManagerAbi = require('./depositManagerAbi.json'); // ABI for deposit contract

// ─── CONFIGURATION SECTION ─────────────────────────────────────────────────────

// Extract configuration from environment variables
const {
  PRIVATE_KEY,       // Wallet private key for signing transactions
  SEPOLIA_RPC,       // Ethereum Sepolia RPC endpoint  
  AMOY_RPC,          // Polygon Amoy RPC endpoint
  DEPOSIT_MANAGER,   // Deposit manager contract on Sepolia
  POL_SEPOLIA,       // POL token contract on Sepolia
  POL_AMOY,          // POL token contract on Amoy (native: 0x...1010)
  CHILD_MANAGER,     // Child chain manager (optional)
  ERC20_PREDICATE,   // ERC20 predicate for exit processing on Sepolia
  WITHDRAW_MANAGER,  // Withdraw manager for finalizing exits on Sepolia
} = process.env;

// Validate required environment variables
if (!PRIVATE_KEY) {
  console.error('⚠️  Set PRIVATE_KEY in .env');
  process.exit(1);
}
if (!POL_AMOY) {
  console.error('⚠️  Set POL_AMOY (the child‐chain POL token address) in .env');
  process.exit(1);
}

// Initialize providers for both networks
// Provider = connection to blockchain network for reading data
const providerSepolia = new ethers.JsonRpcProvider(SEPOLIA_RPC);  // Ethereum Sepolia connection
const providerAmoy = new ethers.JsonRpcProvider(AMOY_RPC);        // Polygon Amoy connection

// Initialize wallets for both networks  
// Wallet = provider + private key for signing transactions
const walletSepolia = new ethers.Wallet(PRIVATE_KEY, providerSepolia); // For Sepolia transactions
const walletAmoy = new ethers.Wallet(PRIVATE_KEY, providerAmoy);       // For Amoy transactions

// ─── CONTRACT ABIs (Application Binary Interfaces) ─────────────────────────────
// ABIs define the interface for calling smart contract functions

// Standard ERC-20 token functions
const erc20Abi = [
  'function approve(address spender, uint256 amount) external returns (bool)',  // Allow contract to spend tokens
];

// Child token withdrawal functions (used on Amoy)
const childWithdrawAbi = [
  'function withdraw(uint256 amount) external',                               // Primary withdrawal method
  'function transfer(address to, uint256 amount) external returns (bool)',    // Alternative transfer method  
  'function burn(uint256 amount) external'                                    // Token burning method
];

// ─── CONTRACT INSTANCES ────────────────────────────────────────────────────────
// Create contract instances for interacting with deployed smart contracts

// Deposit Manager contract on Sepolia (handles L1 → L2 deposits)
const depositManager = new ethers.Contract(
  DEPOSIT_MANAGER,           // Contract address on Sepolia
  rootChainManagerAbi,       // ABI from JSON file
  walletSepolia              // Wallet for signing transactions
);

// POL token contract on Sepolia (ERC-20 token)
const polSepolia = new ethers.Contract(
  POL_SEPOLIA,               // POL token address on Sepolia
  erc20Abi,                  // Standard ERC-20 ABI
  walletSepolia              // Wallet for signing transactions
);

// Child chain manager on Amoy (optional, for approvals if needed)
const childManager = new ethers.Contract(
  CHILD_MANAGER,             // Manager contract address on Amoy
  erc20Abi,                  // Standard ERC-20 ABI
  walletAmoy                 // Wallet for signing transactions
);

// POL token contract on Amoy (native POL contract at 0x...1010)
const polAmoy = new ethers.Contract(
  POL_AMOY,                  // Native POL contract address on Amoy
  childWithdrawAbi,          // Withdrawal/burn ABI functions
  walletAmoy                 // Wallet for signing transactions
);

// ─── DEPOSIT FUNCTION: Sepolia → Amoy ──────────────────────────────────────────
/**
 * Deposits POL tokens from Ethereum Sepolia to Polygon Amoy
 * 
 * Process:
 * 1. Parse amount from command line arguments
 * 2. Approve DepositManager to spend POL tokens
 * 3. Call depositERC20ForUser to initiate cross-chain transfer
 * 4. Tokens appear on Amoy in ~25 minutes
 * 
 * Usage: node bridge.js deposit [amount]
 */
async function bridgePOL() {
  // Parse amount from command line arguments (3rd argument after "node bridge.js deposit")
  const amountArg = process.argv[3];     // Get command line argument
  const amount = amountArg || '1';       // Default to 1 POL if no amount specified
  const amountWei = ethers.parseEther(amount); // Convert to wei (smallest unit)
  
  console.log(`Depositing ${amount} POL (${ethers.formatEther(amountWei)} POL)`);

  // Step 1: Approve the DepositManager contract to spend our POL tokens
  // This is required before any ERC-20 transfer by a third party
  console.log('1) Approving DepositManager on Sepolia…');
  const approveTx = await polSepolia.approve(DEPOSIT_MANAGER, amountWei);
  await approveTx.wait(); // Wait for transaction to be mined
  console.log('  ✔ Approval:', `https://sepolia.etherscan.io/tx/${approveTx.hash}`);

  // Step 2: Call the deposit function to transfer tokens to Amoy
  // depositERC20ForUser burns tokens on L1 and mints equivalent on L2
  console.log('2) depositERC20ForUser on Sepolia…');
  const depositTx = await depositManager.depositERC20ForUser(
    POL_SEPOLIA,           // Token contract address on Sepolia
    walletSepolia.address, // Recipient address (our wallet)
    amountWei              // Amount to deposit in wei
  );
  await depositTx.wait(); // Wait for transaction to be mined
  console.log('  ✔ Deposit:', `https://sepolia.etherscan.io/tx/${depositTx.hash}`);
  console.log('✅ Deposit confirmed — funds will arrive on Amoy in ~25 min.');
}

// ─── CHECKPOINT POLLING FUNCTION ───────────────────────────────────────────────
/**
 * Polls the Polygon proof generation API to check if a transaction has been checkpointed
 * 
 * Checkpointing process:
 * - Polygon validators periodically submit Merkle roots of Amoy transactions to Ethereum
 * - Once included in a checkpoint, transactions can generate proofs for exit
 * - Typically takes 90-180 minutes on testnet
 * 
 * @param {string} txHash - Transaction hash from Amoy burn transaction
 * @returns {Object} Proof data when transaction is checkpointed
 */
async function waitForCheckpoint(txHash) {
  // Construct proof generation API URL with Withdraw event signature
  // Event signature 0xebff2602... corresponds to the Withdraw event emitted during burn
  const proofUrl = `https://proof-generator.polygon.technology/api/v1/amoy/exit-payload/${txHash}?eventSignature=0xebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f`;
  
  console.log('🔍 Polling checkpoint status...');
  let attempts = 0;
  const maxAttempts = 360; // 180 minutes max (30 second intervals)
  
  // Poll the API every 30 seconds until transaction is checkpointed
  while (attempts < maxAttempts) {
    try {
      console.log(`   ⏰ Attempt ${attempts + 1}/${maxAttempts} - Checking checkpoint...`);
      
      // Make HTTP request to proof generation API
      const response = await fetch(proofUrl);
      
      if (response.ok) {
        // Success: transaction is checkpointed and proof is available
        const data = await response.json();
        console.log('✅ Transaction checkpointed! Proof generated successfully.');
        console.log('📄 Proof data length:', data.result?.length || 'Unknown');
        return data; // Return proof data for exit processing
      } else if (response.status === 400) {
        // Expected: transaction not yet checkpointed
        console.log(`   ⏳ Not checkpointed yet... waiting 30 seconds`);
      } else {
        // Unexpected status, but retry
        console.log(`   ⚠️  API returned status ${response.status}, retrying...`);
      }
    } catch (error) {
      // Network error or other issue, log and retry
      console.log(`   ❌ Error checking status: ${error.message}`);
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds before retry
  }
  
  // Timeout: transaction not checkpointed within time limit
  throw new Error('Checkpoint timeout - transaction not checkpointed after 180 minutes');
}

// ─── EXIT PROCESSING FUNCTION ──────────────────────────────────────────────────
/**
 * Processes the exit on Ethereum Sepolia using the generated proof
 * 
 * Two-step process:
 * 1. startExitWithBurntTokens: Submit proof to ERC20 Predicate contract
 * 2. processExits: Finalize withdrawal and release tokens (after challenge period)
 * 
 * @param {Object} proofData - Merkle proof data from checkpoint API
 */
async function processExit(proofData) {
  try {
    console.log('📋 Step 1: Starting exit on ERC20 Predicate...');
    
    // Step 1: Submit the Merkle proof to the ERC20 Predicate contract
    // This proves that tokens were burned on Amoy and initiates the exit process
    const predicateContract = new ethers.Contract(
      ERC20_PREDICATE,     // ERC20 Predicate contract address on Sepolia
      ['function startExitWithBurntTokens(bytes calldata data) external'], // Function signature
      walletSepolia        // Wallet for signing the transaction
    );
    
    try {
      // Submit the proof data to start the exit process
      const startExitTx = await predicateContract.startExitWithBurntTokens(proofData.result);
      await startExitTx.wait(); // Wait for transaction confirmation
      console.log('  ✔ StartExit:', `https://sepolia.etherscan.io/tx/${startExitTx.hash}`);
    } catch (startExitError) {
      // Handle case where exit was already started (KNOWN_EXIT error)
      if (startExitError.message.includes('KNOWN_EXIT')) {
        console.log('  ℹ️  Exit already started for this transaction');
        console.log('  ✅ Proceeding to finalize exit...');
      } else {
        throw startExitError; // Re-throw other errors
      }
    }
    
    console.log('📋 Step 2: Processing exit on Withdraw Manager...');
    
    // Step 2: Call processExits to finalize the withdrawal
    // This releases the tokens from the locked state and transfers them to the user
    const withdrawContract = new ethers.Contract(
      WITHDRAW_MANAGER,    // Withdraw Manager contract address on Sepolia
      ['function processExits(address _token) external'], // Function signature
      walletSepolia        // Wallet for signing the transaction
    );
    
    // On testnet, there's typically no challenge period, so we can process immediately
    console.log('  🚀 Attempting to process exits (testnet - no challenge period)...');
    const processExitTx = await withdrawContract.processExits(POL_SEPOLIA);
    await processExitTx.wait(); // Wait for transaction confirmation
    console.log('  ✔ ProcessExit:', `https://sepolia.etherscan.io/tx/${processExitTx.hash}`);
    
    console.log('💰 POL tokens released on Sepolia!');
    
  } catch (error) {
    console.error('❌ Exit processing failed:', error.message);
    
    if (error.message.includes('KNOWN_EXIT')) {
      console.log('\n💡 Exit already initiated! Trying to finalize immediately...');
      try {
        const withdrawContract = new ethers.Contract(
          WITHDRAW_MANAGER,
          ['function processExits(address _token) external'],
          walletSepolia
        );
        
        const processExitTx = await withdrawContract.processExits(POL_SEPOLIA);
        await processExitTx.wait();
        console.log('  ✔ ProcessExit:', `https://sepolia.etherscan.io/tx/${processExitTx.hash}`);
        console.log('💰 POL tokens released on Sepolia!');
        return;
      } catch (finalizeError) {
        console.log('⚠️  Could not immediately finalize. You can try:');
        console.log('   npm run finalize');
      }
    }
    
    console.log('💡 You can complete the exit manually using the proof:');
    console.log('   Proof data:', proofData.result);
    throw error;
  }
}

// ─── WITHDRAWAL FUNCTION: Amoy → Sepolia ───────────────────────────────────────
/**
 * Withdraws POL tokens from Polygon Amoy back to Ethereum Sepolia
 * 
 * Complete withdrawal process:
 * 1. Parse withdrawal amount from command line
 * 2. Check POL balance on Amoy
 * 3. Call withdraw() on POL contract (burns tokens + emits Withdraw event)
 * 4. Wait for checkpoint inclusion (90-180 minutes)
 * 5. Generate Merkle proof from checkpoint
 * 6. Submit proof to ERC20 Predicate on Sepolia (start exit)
 * 7. Process exit to release tokens (immediate on testnet)
 * 
 * Usage: node bridge.js withdraw [amount]
 */
async function withdrawPOL() {
  // Step 0: Sanity check that POL_AMOY contract exists
  const code = await providerAmoy.getCode(POL_AMOY);
  if (code === '0x') {
    console.error(
      `❌ No contract found at POL_AMOY (${POL_AMOY}).\n` +
      `   Make sure you copied the *token* contract address (from Amoy Polygonscan Token Tracker), not the manager/predicate.`
    );
    return;
  }

  // Step 1: Check current POL balance on Amoy
  const viewAbi = ['function balanceOf(address) view returns (uint256)'];
  const tokenView = new ethers.Contract(POL_AMOY, viewAbi, providerAmoy);
  const bal = await tokenView.balanceOf(walletAmoy.address);
  console.log('Amoy POL balance:', ethers.formatEther(bal));

  // Step 2: Parse withdrawal amount from command line arguments
  const amountArg = process.argv[3];     // Get 3rd argument after "node bridge.js withdraw"
  const amount = amountArg || '1';       // Default to 1 POL if no amount specified
  const withdrawAmount = ethers.parseEther(amount); // Convert to wei
  
  console.log(`Withdrawing ${amount} POL (${ethers.formatEther(withdrawAmount)} POL)`);
  
  // Step 3: Validate sufficient balance
  if (bal < withdrawAmount) {
    console.error(`❌ Insufficient balance. Need ${ethers.formatEther(withdrawAmount)} POL, have ${ethers.formatEther(bal)} POL`);
    return;
  }

  console.log('Withdrawing:', ethers.formatEther(withdrawAmount), 'POL');

  // Step 4: Call withdraw function on POL contract to burn tokens
  console.log('1) Calling withdraw function on POL contract…');
  let burnTx;
  try {
    // Create contract instance for the POL token on Amoy
    const polContract = new ethers.Contract(
      POL_AMOY,                                              // Native POL contract address
      ['function withdraw(uint256 amount) public payable'],  // Function signature
      walletAmoy                                             // Wallet for signing
    );
    
    // Important: POL withdraw function requires msg.value = amount
    // This is because we're dealing with the native POL contract
    burnTx = await polContract.withdraw(withdrawAmount, {
      value: withdrawAmount // Send POL as native value (msg.value must equal amount parameter)
    });
    await burnTx.wait(); // Wait for transaction to be mined
    console.log('  ✔ Burn:', `https://amoy.polygonscan.com/tx/${burnTx.hash}`);
  } catch (error) {
    console.error('❌ Burn transaction failed:', error.message);
    return;
  }

  // Step 5: Handle checkpoint waiting and exit processing
  console.log('2) Waiting for checkpoint inclusion...');
  console.log('   ⏰ This can take 90-180 minutes on testnet');
  console.log('   🔗 Burn tx:', `https://amoy.polygonscan.com/tx/${burnTx.hash}`);
  
  // Display manual steps for reference
  console.log('\n📋 Next steps after checkpoint:');
  console.log('1. Generate proof from:', `https://proof-generator.polygon.technology/api/v1/amoy/exit-payload/${burnTx.hash}?eventSignature=0xebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f`);
  console.log('2. Use the proof with ERC20 Predicate contract on Sepolia');
  console.log('3. Process exit to complete withdrawal');
  
  // Check if automatic completion is enabled
  if (process.env.AUTO_COMPLETE === 'true') {
    // Automatic mode: wait for checkpoint and complete exit automatically
    console.log('\n⏳ Auto-completion enabled, polling for checkpoint...');
    const proofData = await waitForCheckpoint(burnTx.hash); // Wait for checkpoint inclusion
    
    // Process the exit using the generated proof
    console.log('3) Processing exit on Sepolia...');
    await processExit(proofData); // Submit proof and finalize withdrawal
    console.log('✅ Automatic withdrawal completed!');
  } else {
    // Manual mode: user needs to check status and complete exit manually
    console.log('\n💡 Set AUTO_COMPLETE=true in .env to enable automated completion');
  }
}

// ─── CHECKPOINT STATUS CHECKER ────────────────────────────────────────────────
/**
 * Checks the checkpoint status of a withdrawal transaction
 * 
 * This utility function allows checking withdrawal progress without keeping
 * the console open for hours. Users can check periodically until checkpointed.
 * 
 * Usage: node bridge.js check <transaction_hash>
 */
async function checkStatus() {
  const txHash = process.argv[3];
  if (!txHash) {
    console.error('❌ Please provide transaction hash');
    console.log('Usage: node bridge.js check <transaction_hash>');
    return;
  }

  console.log(`🔍 Checking checkpoint status for: ${txHash}`);
  
  try {
    const proofUrl = `https://proof-generator.polygon.technology/api/v1/amoy/exit-payload/${txHash}?eventSignature=0xebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f`;
    
    const response = await fetch(proofUrl);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Transaction is checkpointed!');
      console.log('📄 Proof data length:', data.result?.length || 'Unknown');
      console.log('\n🔗 Links:');
      console.log('   Transaction:', `https://amoy.polygonscan.com/tx/${txHash}`);
      console.log('   Proof API:', proofUrl);
      
      // Ask if user wants to complete exit
      console.log('\n💡 Ready to complete exit? Run:');
      console.log(`   node bridge.js exit ${txHash}`);
      
    } else if (response.status === 400 || response.status === 404) {
      console.log('⏳ Transaction not yet checkpointed');
      console.log('📍 Current status: Waiting for checkpoint inclusion');
      console.log('\n🔗 Links:');
      console.log('   Transaction:', `https://amoy.polygonscan.com/tx/${txHash}`);
      console.log('   Check again: node bridge.js check', txHash);
      
    } else {
      console.log(`⚠️  API returned status ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Error checking status:', error.message);
  }
}

// ─── EXIT COMPLETION ───────────────────────────────────────────────────────────
/**
 * Completes the withdrawal exit process for a checkpointed transaction
 * 
 * This function handles the final steps of withdrawal:
 * 1. Fetches the proof for the transaction (must be checkpointed)
 * 2. Submits proof to ERC20 Predicate on Sepolia
 * 3. Processes the exit to release tokens
 * 
 * Usage: node bridge.js exit <transaction_hash>
 */
async function completeExit() {
  const txHash = process.argv[3];
  if (!txHash) {
    console.error('❌ Please provide transaction hash');
    console.log('Usage: node bridge.js exit <transaction_hash>');
    return;
  }

  console.log(`🚀 Completing exit for: ${txHash}`);
  
  try {
    // Generate proof
    const proofData = await waitForCheckpoint(txHash);
    
    // Process exit
    await processExit(proofData);
    console.log('✅ Exit completed successfully!');
    
  } catch (error) {
    console.error('❌ Exit completion failed:', error.message);
  }
}

// ─── FINALIZE EXIT ────────────────────────────────────────────────────────────
/**
 * Finalizes all pending exits for POL tokens
 * 
 * This function calls processExits on the Withdraw Manager to finalize
 * all exits that have completed their challenge period. Use this when
 * you have pending exits that are ready to be processed.
 * 
 * Usage: node bridge.js finalize
 */
async function finalizeExit() {
  console.log('🏁 Finalizing exits after challenge period...');
  
  try {
    // Call processExits on Withdraw Manager to finalize all pending exits
    const withdrawContract = new ethers.Contract(
      WITHDRAW_MANAGER,
      ['function processExits(address _token) external'],
      walletSepolia
    );
    
    const processExitTx = await withdrawContract.processExits(POL_SEPOLIA);
    await processExitTx.wait();
    console.log('  ✔ ProcessExit:', `https://sepolia.etherscan.io/tx/${processExitTx.hash}`);
    
    console.log('💰 All eligible POL tokens have been released on Sepolia!');
    
  } catch (error) {
    console.error('❌ Finalization failed:', error.message);
    console.log('💡 Make sure the 7-day challenge period has passed');
  }
}

// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────────────
/**
 * Main application entry point - routes commands to appropriate functions
 * 
 * Available commands:
 * - deposit [amount]     : Deposit POL from Sepolia to Amoy
 * - withdraw [amount]    : Withdraw POL from Amoy to Sepolia
 * - check <tx_hash>      : Check withdrawal checkpoint status
 * - exit <tx_hash>       : Complete withdrawal exit process
 * - finalize             : Finalize all pending exits
 * 
 * Examples:
 * - node bridge.js deposit 5
 * - node bridge.js withdraw 10
 * - node bridge.js check 0xabc123...
 */
async function main() {
  const mode = process.argv[2];
  if (mode === 'deposit') {
    await bridgePOL();
  } else if (mode === 'withdraw') {
    await withdrawPOL();
  } else if (mode === 'check') {
    await checkStatus();
  } else if (mode === 'exit') {
    await completeExit();
  } else if (mode === 'finalize') {
    await finalizeExit();
  } else {
    console.log('Usage:');
    console.log('  node bridge.js deposit [amount]');
    console.log('  node bridge.js withdraw [amount]');
    console.log('  node bridge.js check <transaction_hash>');
    console.log('  node bridge.js exit <transaction_hash>');
    console.log('  node bridge.js finalize');
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
