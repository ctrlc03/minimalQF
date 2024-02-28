import "@nomicfoundation/hardhat-toolbox"
import "hardhat-artifactor"

import type { HardhatUserConfig } from "hardhat/config"

import { task, subtask } from "hardhat/config"

import path from "path"
import fs from "fs"

import dotenv from "dotenv"
dotenv.config()

/**
 * Allow to copy a directory from source to target
 * @param source - the source directory
 * @param target - the target directory
 */
function copyDirectory(source: string, target: string): void {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true })
    }

    if (!fs.existsSync(source)) {
        return
    }

    const files = fs.readdirSync(source)

    files.forEach((file: string) => {
        const sourcePath = path.join(source, file)
        const targetPath = path.join(target, file)

        if (fs.lstatSync(sourcePath).isDirectory()) {
            copyDirectory(sourcePath, targetPath)
        } else {
            fs.copyFileSync(sourcePath, targetPath)
        }
    })
}

// Define a subtask to copy artifacts
subtask("copy-maci-artifacts", async (_, { config }) => {
    const sourceDir = path.resolve(__dirname, "node_modules/maci-contracts/build/artifacts/contracts/")
    const destDir = path.resolve(config.paths.artifacts, "maci-contracts", "contracts")

    copyDirectory(sourceDir, destDir)
})

// Override the existing compile task
task("compile", async (args, hre, runSuper) => {
    // Before compilation move over artifacts
    await hre.run("copy-maci-artifacts")

    // Run the original compile task
    await runSuper(args)

    // After compilation, run the subtask to copy MACI artifacts
    await hre.run("copy-maci-artifacts")
})

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
            blockGasLimit: 30000000,
        },
    },
}

export default config
