/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import chalk from "chalk";
import fs from "mz/fs";
import path from "path";
import * as borsh from "borsh";
import * as BufferLayout from "@solana/buffer-layout";
import { Buffer } from "buffer";

import { getPayer, getRpcUrl, createKeypairFromFile } from "./utils";

const log = console.log;
chalk.level = 1; // Use colours in the VS Code Debug Window

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Calculator's program id
 */
let programId: PublicKey;

/**
 * The public key of the calculator account
 */
let calculatorPubKey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, "../../program/dist/program");

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, "solana_calculator.so");

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/solana_calculator.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(
  PROGRAM_PATH,
  "solana_calculator-keypair.json"
);

/**
 * The state of a calculator account managed by the calculator program
 */
class CalculatorAccount {
  result = 0;
  constructor(fields: { result: number } | undefined = undefined) {
    if (fields) {
      this.result = fields.result;
    }
  }
}

/**
 * Borsh schema definition for calculator accounts
 */
const CalculatorSchema = new Map([
  [CalculatorAccount, { kind: "struct", fields: [["result", "u32"]] }],
]);

/**
 * The expected size of each calculator account.
 */
const CALCULATOR_SIZE = borsh.serialize(
  CalculatorSchema,
  new CalculatorAccount()
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, "confirmed");
  const version = await connection.getVersion();
  log(chalk.yellow("Connection to cluster established:", rpcUrl, version));
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const { feeCalculator } = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(CALCULATOR_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  log(
    chalk.yellow(
      "Using account",
      payer.publicKey.toBase58(),
      "containing",
      lamports / LAMPORTS_PER_SOL,
      "SOL to pay for fees"
    )
  );
}

/**
 * Check if the Calculator BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}.`
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        "Program needs to be deployed with `solana program deploy dist/program/solana_calculator.so`"
      );
    } else {
      throw new Error("Program needs to be built and deployed");
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  log(chalk.yellow(`Using program ${programId.toBase58()}`));

  // Derive the address (public key) of a calculator account from the program so that it's easy to find later.
  const CALCULATOR_SEED = "saymyname";
  calculatorPubKey = await PublicKey.createWithSeed(
    payer.publicKey,
    CALCULATOR_SEED,
    programId
  );

  // Check if the greeting account has already been created
  const calculatorAccount = await connection.getAccountInfo(calculatorPubKey);
  if (calculatorAccount === null) {
    log(
      chalk.yellow(
        "Creating account",
        calculatorPubKey.toBase58(),
        "to say hello to"
      )
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      CALCULATOR_SIZE
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: CALCULATOR_SEED,
        newAccountPubkey: calculatorPubKey,
        lamports,
        space: CALCULATOR_SIZE,
        programId,
      })
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

function createAddInstruction(num1: number, num2: number): Buffer {
  const layout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    BufferLayout.u32("num1"),
    BufferLayout.u32("num2"),
  ]);
  const data = Buffer.alloc(layout.span);
  layout.encode({ instruction: 0, num1, num2 }, data);

  return data;
}

function createSubtractInstruction(num1: number, num2: number): Buffer {
  const layout = BufferLayout.struct([
    BufferLayout.u8("instruction"),
    BufferLayout.u32("num1"),
    BufferLayout.u32("num2"),
  ]);
  const data = Buffer.alloc(layout.span);
  layout.encode({ instruction: 1, num1, num2 }, data);

  return data;
}

const instructionMap: Record<string, (num1: number, num2: number) => Buffer> = {
  add: createAddInstruction,
  sub: createSubtractInstruction,
};

/**
 * calculate
 */
export async function calculate(
  operation: string,
  num1: number,
  num2: number
): Promise<void> {
  console.log("Sending calculate request to", calculatorPubKey.toBase58());
  const instructionHandler = instructionMap[operation];
  const instruction = new TransactionInstruction({
    keys: [{ pubkey: calculatorPubKey, isSigner: false, isWritable: true }],
    programId,
    data: instructionHandler(num1, num2), // All instructions are hellos
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer]
  );
}

/**
 * Display the calculation result
 */
export async function displayResult(
  operation: string,
  num1: number,
  num2: number
): Promise<void> {
  const accountInfo = await connection.getAccountInfo(calculatorPubKey);
  if (accountInfo === null) {
    throw "Error: cannot find the calculator account";
  }
  const calculator = borsh.deserialize(
    CalculatorSchema,
    CalculatorAccount,
    accountInfo.data
  );

  const operationType = operation === "add" ? "+" : "-";

  log(chalk.green(`${num1} ${operationType} ${num2} = ${calculator.result}`));
}
