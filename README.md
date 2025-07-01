# POL Token Bridge (Sepolia ↔ Amoy)

A Node.js application for bridging POL tokens between Ethereum Sepolia testnet and Polygon Amoy testnet.

## 🚀 Features

- **Deposit**: Transfer POL tokens from Sepolia to Amoy
- **Withdraw**: Transfer POL tokens from Amoy back to Sepolia
- **Custom Amounts**: Specify any amount for deposits and withdrawals
- **Automatic Processing**: Automated checkpoint detection and exit processing
- **Status Checking**: Check withdrawal status without keeping console open
- **Manual Controls**: Step-by-step control over the bridge process

## 📋 Prerequisites

1. **Node.js** installed on your system
2. **POL tokens** on Sepolia testnet
3. **ETH** on both Sepolia and Amoy for gas fees
4. **Private key** of your wallet

## 🛠 Setup

1. **Clone/Download** the project
2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   - Copy `.env.example` to `.env`
   - Add your `PRIVATE_KEY` to the `.env` file

4. **Verify configuration**:
   - Ensure you have POL tokens on Sepolia for deposits
   - Ensure you have ETH on both networks for gas fees

## 💰 Deposit (Sepolia → Amoy)

Transfer POL tokens from Ethereum Sepolia to Polygon Amoy.

### How Deposit Works:

1. **Approve**: Grant permission to DepositManager to spend your POL tokens
2. **Deposit**: Call `depositERC20ForUser` to initiate the transfer
3. **Wait**: Tokens appear on Amoy in ~25 minutes

### Commands:

```bash
# Default deposit (1 POL)
npm run deposit
# OR
node bridge.js deposit

# Custom amount
npm run deposit -- 5        # Deposit 5 POL
npm run deposit -- 0.5      # Deposit 0.5 POL
npm run deposit -- 100      # Deposit 100 POL

# Direct commands
node bridge.js deposit 25    # Deposit 25 POL
node bridge.js deposit 0.1   # Deposit 0.1 POL
```

### Example Output:
```
Depositing 5 POL (5.0 POL)
1) Approving DepositManager on Sepolia…
  ✔ Approval: https://sepolia.etherscan.io/tx/0x123...
2) depositERC20ForUser on Sepolia…
  ✔ Deposit: https://sepolia.etherscan.io/tx/0x456...
✅ Deposit confirmed — funds will arrive on Amoy in ~25 min.
```

## 🔄 Withdraw (Amoy → Sepolia)

Transfer POL tokens from Polygon Amoy back to Ethereum Sepolia.

### How Withdraw Works:

1. **Burn**: Call `withdraw()` on Amoy POL contract to burn tokens
2. **Checkpoint**: Wait for transaction to be included in checkpoint (~90-180 min)
3. **Proof Generation**: Generate merkle proof when checkpointed
4. **Start Exit**: Submit proof to ERC20 Predicate on Sepolia
5. **Process Exit**: Finalize withdrawal and release tokens

### Commands:

#### **Automatic Withdrawal** (Full Process):
```bash
# Set AUTO_COMPLETE=true in .env file first
npm run withdraw -- 20      # Withdraw 20 POL (automatic)
node bridge.js withdraw 10   # Withdraw 10 POL (automatic)
```

#### **Manual Step-by-Step**:
```bash
# Set AUTO_COMPLETE=false in .env file

# Step 1: Start withdrawal (burn tokens)
npm run withdraw -- 15
# This gives you a transaction hash like: 0xabc123...

# Step 2: Check status periodically (no console waiting!)
npm run check -- 0xabc123...

# Step 3: Complete exit when checkpointed
npm run exit -- 0xabc123...

# Alternative: Finalize all pending exits
npm run finalize
```

### Example Output:

**Automatic Mode:**
```
Withdrawing 20 POL (20.0 POL)
1) Calling withdraw function on POL contract…
  ✔ Burn: https://amoy.polygonscan.com/tx/0x789...
2) Waiting for checkpoint inclusion...
   ⏰ This can take 90-180 minutes on testnet
⏳ Auto-completion enabled, polling for checkpoint...
🔍 Polling checkpoint status...
✅ Transaction checkpointed! Proof generated successfully.
📋 Step 1: Starting exit on ERC20 Predicate...
  ✔ StartExit: https://sepolia.etherscan.io/tx/0xdef...
📋 Step 2: Processing exit on Withdraw Manager...
  ✔ ProcessExit: https://sepolia.etherscan.io/tx/0xghi...
💰 POL tokens released on Sepolia!
✅ Automatic withdrawal completed!
```

**Manual Mode:**
```
# After withdraw command:
Withdrawing 15 POL (15.0 POL)
1) Calling withdraw function on POL contract…
  ✔ Burn: https://amoy.polygonscan.com/tx/0x789...

# Later, checking status:
🔍 Checking checkpoint status for: 0x789...
✅ Transaction is checkpointed!
💡 Ready to complete exit? Run:
   node bridge.js exit 0x789...

# Completing exit:
🚀 Completing exit for: 0x789...
✅ Exit completed successfully!
```

## 🔧 Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `deposit [amount]` | Deposit POL from Sepolia to Amoy | `npm run deposit -- 5` |
| `withdraw [amount]` | Withdraw POL from Amoy to Sepolia | `npm run withdraw -- 10` |
| `check <tx_hash>` | Check withdrawal checkpoint status | `npm run check -- 0xabc...` |
| `exit <tx_hash>` | Complete withdrawal exit process | `npm run exit -- 0xabc...` |
| `finalize` | Finalize all pending exits | `npm run finalize` |

## ⚙️ Configuration

### Environment Variables (`.env`):

```env
# Required
PRIVATE_KEY=your_wallet_private_key_here

# RPC URLs (default provided)
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
AMOY_RPC=https://rpc-amoy.polygon.technology

# Contract Addresses (pre-configured for testnet)
DEPOSIT_MANAGER=0x44ad17990f9128c6d823ee10db7f0a5d40a731a4
POL_SEPOLIA=0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa
POL_AMOY=0x0000000000000000000000000000000000001010
ERC20_PREDICATE=0x15EA6c538cF4b4A4f51999F433557285D5639820
WITHDRAW_MANAGER=0x822db7e79096E7247d9273E5782ecAec464Eb96C

# Automation Settings
AUTO_COMPLETE=true  # Set to false for manual step-by-step control
```

### Key Settings:

- **AUTO_COMPLETE=true**: Automatic withdrawal processing (wait for checkpoint + complete exit)
- **AUTO_COMPLETE=false**: Manual control (stop after burn, check status manually)

## 🕐 Timing

- **Deposit**: ~25 minutes for tokens to appear on Amoy
- **Withdrawal Checkpoint**: ~90-180 minutes on testnet
- **Exit Processing**: Immediate on testnet (no challenge period)

## 🛡️ Security

- Private keys are loaded from `.env` file (never commit this file)
- All transactions are signed locally
- Contract addresses are pre-configured for testnet safety

## 🔗 Useful Links

- **Sepolia Etherscan**: https://sepolia.etherscan.io/
- **Amoy Polygonscan**: https://amoy.polygonscan.com/
- **Polygon Bridge Docs**: https://docs.polygon.technology/

## 🆘 Troubleshooting

### Common Issues:

1. **"Insufficient amount" error**: 
   - Ensure you have enough POL balance
   - For native POL contract, send proper `msg.value`

2. **"KNOWN_EXIT" error**: 
   - Exit already initiated, use `npm run finalize` or wait

3. **Long checkpoint times**: 
   - Testnet checkpoints can take 90-180 minutes
   - Use `npm run check` to monitor status

4. **Gas errors**: 
   - Ensure you have ETH on both networks for gas fees

### Getting Help:

Check transaction hashes on block explorers:
- Sepolia: https://sepolia.etherscan.io/tx/[TX_HASH]
- Amoy: https://amoy.polygonscan.com/tx/[TX_HASH]

## 📝 License

MIT License - See LICENSE file for details.