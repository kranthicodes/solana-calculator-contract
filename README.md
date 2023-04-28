# Solana Calculator Program Rust

This Rust program takes instructions for operation and two numbers to decide if it should add or subtract those two numbers.

## Description

This program is a smart contract written in Rust, a programming language used for developing smart contracts on the Solana blockchain. The contract works with user inputs to add or subtract the numbers provided. A client is available to test or work with the smart contract.

## Getting Started

### Executing program

To run this program, clone the repo, build and deploy the program using the following commands.

**Build**

`cargo build-bpf --manifest-path=./Cargo.toml --bpf-out-dir=dist/program`

**Deploy**

`solana program deploy dist/program/solana_calculator.so`

Once you are done with the above steps, cd into scripts folder and run `npm install` to install the dependencies.

After this step, use the following commands to interact with the contract:

**Add two numbers**

`npm run start -- add <NUM1> <NUM2>`

**Subtract two numbers**

`npm run start -- sub <NUM1> <NUM2>`

## Authors

Sai Kranthi
[@iamsaikranthi](https://twitter.com/iamsaikranthi)

## License

This project is licensed under the MIT License - see the LICENSE.md file for details
