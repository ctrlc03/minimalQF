import "@nomicfoundation/hardhat-toolbox"
import "hardhat-artifactor"

import type { HardhatUserConfig } from "hardhat/config"

import dotenv from "dotenv"
dotenv.config()

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.10",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    gasReporter: {
        currency: "USD",
        enabled: true,
    },
    paths: {
        tests: "./test",
        artifacts: "./artifacts",
    },
    defaultNetwork: "localhost",
    networks: {
        localhost: {
            url: process.env.RPC_URL,
            accounts: [process.env.PRIVATE_KEY!],
        },
    },
}

export default config
