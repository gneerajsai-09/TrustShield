// =====================================================================
//  EDIT THIS FILE. It is the only frontend file you must change to
//  point the app at your own contract, network and backend.
// =====================================================================

// 1. Which network your contract is deployed on: a key from NETWORKS below
const ACTIVE_NETWORK = "sepolia";

// 2. The address Remix printed when you deployed the contract
const CONTRACT_ADDRESS = "0x6844A848Aa2A8940Fe78733947faF9E56bE32653";
const TRUSTSHIELD_ADDRESS = "0xEF615A1c553c463fc386c661DCb56e7e61E4129F";

// 3. Your backend: localhost while building, your Render URL once deployed
const BACKEND_URL = "http://localhost:5000";

// 4. The contract's functions and events, in ethers "human-readable" form.
//    If you change the contract, update this list AND backend/abi.json.
const CONTRACT_ABI = [
  "function store(bytes32 hash) returns (uint256 id)",
  "function verify(uint256 id, bytes32 hash) view returns (bool)",
  "function records(uint256 id) view returns (bytes32)",
  "function count() view returns (uint256)",
  "event RecordStored(uint256 indexed id, bytes32 hash, address indexed by, uint256 time)",
];

// Supported testnets. Any other EVM testnet works too: add an entry.
const NETWORKS = {
  sepolia: {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    currency: "ETH",
  },
  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://base-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.basescan.org",
    currency: "ETH",
  },
  polygonAmoy: {
    name: "Polygon Amoy",
    chainId: 80002,
    rpcUrl: "https://polygon-amoy-bor-rpc.publicnode.com",
    explorer: "https://amoy.polygonscan.com",
    currency: "POL",
  },
  arbitrumSepolia: {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.arbiscan.io",
    currency: "ETH",
  },
  optimismSepolia: {
    name: "OP Sepolia",
    chainId: 11155420,
    rpcUrl: "https://optimism-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia-optimism.etherscan.io",
    currency: "ETH",
  },
};
