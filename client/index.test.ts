import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenInstruction, getInitializeMintInstruction, getMintToInstruction, getTokenDecoder, TOKEN_PROGRAM_ADDRESS, type Token } from "@solana-program/token";
import {
  AccountRole, appendTransactionMessageInstruction, createTransactionMessage, generateKeyPairSigner, getAddressEncoder, getProgramDerivedAddress, lamports, pipe, setTransactionMessageFeePayerSigner, signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner
} from "@solana/kit";
import { test, describe, beforeAll, expect } from "bun:test";
import { LiteSVM } from "litesvm";
import { deserialize, serialize, type Schema } from "borsh";
import bs58 from "bs58"

describe("escrow", async () => {

  let svm: LiteSVM
  let maker: KeyPairSigner<string>
  let taker: KeyPairSigner<string>
  let offerId: number
  let mint_a_keypair: KeyPairSigner<string>
  let mint_b_keypair: KeyPairSigner<string>
  let offerPda: Address<string>
  let offerPdaAta: Address<string>
  let takerTokenbAta: Address<string>
  let makerTokenaAmount: Token
  let makerAtaTokenA: Address<string>
  let taker_b_amount: Token
  let progmamId: KeyPairSigner<string>

  beforeAll(async () => {
    svm = new LiteSVM();
    progmamId = await generateKeyPairSigner();

    svm.addProgramFromFile(progmamId.address, "/home/cell/probe/sol/escrow/target/deploy/escrow.so");

    const payer = await generateKeyPairSigner();

    maker = await generateKeyPairSigner();
    taker = await generateKeyPairSigner();

    svm.airdrop(maker.address, lamports(BigInt(1000000000)));
    svm.airdrop(payer.address, lamports(BigInt(1000000000)));
    svm.airdrop(taker.address, lamports(BigInt(1000000000)));

    offerId = Math.floor(Math.random() * 10000 + 1);

    // give the pda account. token a mint, token b mint,  maker ata account, 
    // Instruction data - token a mount, token b amount, offerId

    mint_a_keypair = await generateKeyPairSigner();

    // first createAccountIInstruction with data for mint size


    const createMintaAccount = getCreateAccountInstruction({
      payer: payer,
      newAccount: mint_a_keypair,
      lamports: lamports(2461440n),
      space: 82,
      programAddress: TOKEN_PROGRAM_ADDRESS
    })

    const token_a = getInitializeMintInstruction({
      mint: mint_a_keypair.address,
      decimals: 9,
      mintAuthority: payer.address,
      freezeAuthority: null
    })

    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
      (tx) => appendTransactionMessageInstruction(createMintaAccount, tx),
      (tx) => appendTransactionMessageInstruction(token_a, tx),
      (tx) => signTransactionMessageWithSigners(tx)
    )

    let res = svm.sendTransaction(tx)

    console.log(res.toString())

    // send mint token a to maker
    const [ata] = await findAssociatedTokenPda({ // maker ata for tokena
      owner: maker.address,
      mint: mint_a_keypair.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS
    })

    makerAtaTokenA = ata

    let token_a_ata = getCreateAssociatedTokenInstruction({
      payer: payer,
      ata: ata,
      owner: maker.address,
      mint: mint_a_keypair.address
    })


    // createMint

    let mint_ix = getMintToInstruction({
      mint: mint_a_keypair.address,
      token: ata,
      mintAuthority: payer.address,
      amount: BigInt(1000 * 1000000000) // since we  mentioned 9 decimals
    })


    const tx2 = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
      (tx) => appendTransactionMessageInstruction(token_a_ata, tx),
      (tx) => appendTransactionMessageInstruction(mint_ix, tx),
      (tx) => signTransactionMessageWithSigners(tx),
    )



    let res2 = svm.sendTransaction(tx2)


    console.log("res2", res2.toString())


    let acc_info = svm.getAccount(ata) as any

    makerTokenaAmount = getTokenDecoder().decode(acc_info.data) // storing for late asssertions 

    console.log("maker amount", makerTokenaAmount.amount)

    // create token_b mint 
    //
    mint_b_keypair = await generateKeyPairSigner();

    // first createAccountIInstruction with data for mint size


    const createMintbAccount = getCreateAccountInstruction({
      payer: payer,
      newAccount: mint_b_keypair,
      lamports: lamports(2461440n),
      space: 82,
      programAddress: TOKEN_PROGRAM_ADDRESS
    })

    const token_b = getInitializeMintInstruction({
      mint: mint_b_keypair.address,
      decimals: 9,
      mintAuthority: payer.address,
      freezeAuthority: null
    })

    const tx3 = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
      (tx) => appendTransactionMessageInstruction(createMintbAccount, tx),
      (tx) => appendTransactionMessageInstruction(token_b, tx),
      (tx) => signTransactionMessageWithSigners(tx)
    )

    svm.sendTransaction(tx3)


    // send mint token b to taker
    const [ata_token_b] = await findAssociatedTokenPda({ // create ata of token b for taker
      owner: taker.address,
      mint: mint_b_keypair.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS
    })

    takerTokenbAta = ata_token_b

    let token_b_ata = getCreateAssociatedTokenInstruction({
      payer: payer,
      ata: ata_token_b,
      owner: taker.address,
      mint: mint_b_keypair.address
    })


    // createMint

    let mint_ix2 = getMintToInstruction({
      mint: mint_b_keypair.address,
      token: ata_token_b, // mint token b to taker
      mintAuthority: payer.address,
      amount: BigInt(5000 * 1000000000) // since we  mentioned 9 decimals
    })


    const tx4 = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
      (tx) => appendTransactionMessageInstruction(token_b_ata, tx),
      (tx) => appendTransactionMessageInstruction(mint_ix2, tx),
      (tx) => signTransactionMessageWithSigners(tx),
    )


    svm.sendTransaction(tx4)

    let taker_ata = svm.getAccount(ata_token_b);
    if (!taker_ata.exists) {
      throw new Error("account not exists")
    }
    taker_b_amount = getTokenDecoder().decode(taker_ata.data);

    console.log("taker b tokens", taker_b_amount.amount)


  })
  test("InitializeOffer", async () => {

    // now do instruction to program with all accounts token a mint. token_b mint
    // instruction data -? token_a amount, token_b amount, offerId
    const InitializeOffer = {
      struct: {
        token_a_amount: "u64",
        token_b_amount: "u64",
        offer_id: "u64"
      }
    }
    const value = {
      token_a_amount: BigInt(makerTokenaAmount.amount),
      token_b_amount: BigInt(taker_b_amount.amount),
      offer_id: BigInt(offerId),
    }


    // in this function first we define the schema of instruciton. and then give actual vaules to the schema fields
    let data = serialize(InitializeOffer, value)

    const buffer = new ArrayBuffer(8); // create raw binary cant read it
    const view = new DataView(buffer) // read through DataView to see what actually are

    // 0x1234 [0x12, 0x34] creates array of 8 bytes of bigint. 
    view.setBigInt64(0, BigInt(offerId), true);

    const [offer_pda] = await getProgramDerivedAddress({
      programAddress: progmamId.address,
      seeds: [
        Buffer.from("escrow"),
        getAddressEncoder().encode(maker.address),
        new Uint8Array(buffer)
      ]
    });

    offerPda = offer_pda

    let maker_before_offer = svm.getAccount(makerAtaTokenA)

    if (!maker_before_offer.exists) {
      throw new Error("account not exists")
    }
    let maker_token_a_before_instruction = getTokenDecoder().decode(maker_before_offer.data)

    let [offer_pda_ata] = await findAssociatedTokenPda({ // ata for offer_pda
      owner: offer_pda,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: mint_a_keypair.address
    })
    offerPdaAta = offer_pda_ata

    let vault_account_before_ix = svm.getAccount(offer_pda_ata) as any
    const instruction: Instruction = {
      programAddress: progmamId.address,
      accounts: [ // maker, token_a_mint, token_b_mint, pda account address, ata program, system program
        {
          address: maker.address,
          role: AccountRole.WRITABLE_SIGNER
        },
        {
          address: mint_a_keypair.address,
          role: AccountRole.READONLY
        },
        {
          address: mint_b_keypair.address,
          role: AccountRole.READONLY
        },
        {
          address: offer_pda,
          role: AccountRole.WRITABLE // this will be created with data
        },
        {
          address: offer_pda_ata,
          role: AccountRole.WRITABLE // since this wiilll hold the funds
        },
        {
          address: makerAtaTokenA, // maker ata a
          role: AccountRole.WRITABLE
        },
        {
          address: TOKEN_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        },
        {
          address: SYSTEM_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        },
        {
          address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        }
      ],
      data: new Uint8Array([0, ...data]) // conveer the destruction the data array into this array
    }

    const maker_offer_tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(maker, tx),
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx), // getting the latest block hash using the svm local chain
      (tx) => appendTransactionMessageInstruction(instruction, tx),
      (tx) => signTransactionMessageWithSigners(tx),
    )

    let response = svm.sendTransaction(maker_offer_tx);

    console.log(response.toString())


    let maker_token_a_after_instruction = svm.getAccount(makerAtaTokenA)

    if (!maker_token_a_after_instruction.exists) {
      throw new Error("account not exist")
    }

    let maker_after_offer = getTokenDecoder().decode(maker_token_a_after_instruction.data)

    let vault_account_after_ix = svm.getAccount(offer_pda_ata)

    if (!vault_account_after_ix.exists) {
      throw new Error("account not exist")
    }
    let vault_after_offer = getTokenDecoder().decode(vault_account_after_ix.data)


    console.log("maker amount after offer", maker_after_offer.amount)
    console.log("vault after offer", vault_after_offer.amount)

    const offerAccount = svm.getAccount(offer_pda);
    if (!offerAccount.exists) {
      throw new Error("account not exist")
    }

    const Vault: Schema = {
      struct: {
        maker: { array: { type: "u8", len: 32 } },
        token_a_mint: { array: { type: "u8", len: 32 } },
        token_b_mint: { array: { type: "u8", len: 32 } },
        token_b_amount: "u64",
        offer_id: "u64",
        bump: "u8"
      }
    }

    expect(offerAccount, "offer pda did not Initialize").not.toBeNull();
    expect(maker_after_offer.amount, "maker lost expected tokens").toBe(
      maker_token_a_before_instruction.amount - makerTokenaAmount.amount
    )
    expect(offerAccount.programAddress.toString(), "wrong offer pda account").toBe(progmamId.address.toString())

    const offer = deserialize(Vault, offerAccount.data) as any
    const offerMaker = bs58.encode(offer.maker); // since it stores the actualy bytes not the address

    expect(vault_account_before_ix.exists, "vault shouldnt exist").toBe(false)
    expect(vault_account_after_ix.exists, "vault doesnt exists").toBe(true)
    expect(offerMaker).toBe(maker.address.toString())
    expect(offer.offer_id).toBe(BigInt(offerId))
    expect(makerTokenaAmount.amount, "wrong token_a_amount in vault").toBe(vault_after_offer.amount)
    expect(offer.token_b_amount, "wrong token_a_amount in vault").toBe(taker_b_amount.amount)
  })

  test("TakeOffer", async () => {

    const [maker_token_b_ata] = await findAssociatedTokenPda({
      owner: maker.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: mint_b_keypair.address
    })

    const tokenb = svm.getAccount(takerTokenbAta) as any
    let something = getTokenDecoder().decode(tokenb.data)
    console.log("taker token b before", something.amount)

    const a = svm.getAccount(offerPdaAta)

    if (!a.exists) {
      throw new Error("account not exist")
    }

    let vault_before_take_offer = getTokenDecoder().decode(a.data)
    const taker_token_b_before_offer = getTokenDecoder().decode((svm.getAccount(takerTokenbAta) as any).data)

    console.log("vault before take", vault_before_take_offer.amount)

    const Vault: Schema = {
      struct: {
        maker: { array: { type: "u8", len: 32 } },
        token_a_mint: { array: { type: "u8", len: 32 } },
        token_b_mint: { array: { type: "u8", len: 32 } },
        token_b_amount: "u64",
        offer_id: "u64",
        bump: "u8"
      }
    }
    const offerAccount = svm.getAccount(offerPda);
    if (!offerAccount.exists) {
      throw new Error("account not exist")
    }
    const offer = deserialize(Vault, offerAccount.data) as any




    const [taker_token_a_ata] = await findAssociatedTokenPda({
      owner: taker.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: mint_a_keypair.address
    })

    let instruction: Instruction = {
      programAddress: progmamId.address,
      accounts: [
        {
          address: maker.address,
          role: AccountRole.WRITABLE, // writable to put pda close rent to maker
        },
        {
          address: taker.address,
          role: AccountRole.WRITABLE_SIGNER,
        },
        {
          address: mint_a_keypair.address,
          role: AccountRole.READONLY
        },
        {
          address: mint_b_keypair.address,
          role: AccountRole.READONLY
        },
        {
          address: offerPda,
          role: AccountRole.WRITABLE
        },
        {
          address: offerPdaAta,
          role: AccountRole.WRITABLE
        },
        { // maker ata token b
          address: maker_token_b_ata,
          role: AccountRole.WRITABLE
        },
        { // taker ata token b
          address: takerTokenbAta,
          role: AccountRole.WRITABLE
        }, // taker ata token a
        {
          address: taker_token_a_ata,
          role: AccountRole.WRITABLE
        },
        {
          address: TOKEN_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        },
        {
          address: SYSTEM_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        },
        {
          address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
          role: AccountRole.READONLY
        }
      ],
      data: new Uint8Array([1]) // 1 for second option in enum which is 
    }

    const tx = await pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(taker, tx), // fee payer and signer
      (tx) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(tx),
      (tx) => appendTransactionMessageInstruction(instruction, tx),
      (tx) => signTransactionMessageWithSigners(tx), // gets all the signer from the instruction if any account is signing
    )

    const res = svm.sendTransaction(tx)
    expect(res.toString()).toContain("TransactionMetadata")

    const vault_after_takeOffer = svm.getAccount(offerPdaAta);

    if (vault_after_takeOffer.exists) {
      throw new Error("account shouldnt exists")
    }

    const taker_token_b_after_offer = getTokenDecoder().decode((svm.getAccount(takerTokenbAta) as any).data)
    const taker_token_a_after_offer = getTokenDecoder().decode((svm.getAccount(taker_token_a_ata) as any).data)
    const maker_token_b_after_offer = getTokenDecoder().decode((svm.getAccount(maker_token_b_ata) as any).data)

    expect(vault_before_take_offer.amount).toBe(makerTokenaAmount.amount)
    // vault close(vault after takeOffer shouldnt not exists)
    expect(vault_after_takeOffer.exists).toBe(false)
    // check taker b tokens after offer to be - taker b amount before - taker_b_amount
    expect(taker_token_b_after_offer.amount, "taker transfer wrong tokens b amount").toBe(taker_token_b_before_offer.amount - offer.token_b_amount)
    expect(maker_token_b_after_offer.amount, "maker did not get enough b tokens").toBe(offer.token_b_amount)
    // check taker a tokens to token_a_amount
    expect(taker_token_a_after_offer.amount, "taker did not get vault amount").toBe(vault_before_take_offer.amount)
    expect(taker_token_a_after_offer.amount, "taker got wrong amount").toBe(makerTokenaAmount.amount)
    // check maker b tokens amount to token_b_amount
    // offerPda close
    expect(svm.getAccount(offerPda).exists, "Offer pda did not closes").toBe(false)
  })

})

