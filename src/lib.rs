use borsh::{BorshDeserialize, BorshSerialize };
use solana_program::{account_info::{AccountInfo, next_account_info}, entrypoint, msg, program::{invoke, invoke_signed}, program_error::ProgramError, program_pack::Pack, pubkey::Pubkey, rent::Rent, system_instruction::create_account, sysvar::Sysvar};
use spl_associated_token_account::{get_associated_token_address, instruction::{create_associated_token_account, create_associated_token_account_idempotent}};
use spl_token::{instruction::{close_account, transfer}, state::Account};


entrypoint!(process_instruction);


#[derive(BorshSerialize, BorshDeserialize)]
// vault or offer
struct Vault { // 32 +  32 + 32 + 8 + 8 + 1
    maker: Pubkey, 
    token_a_mint: Pubkey,
    token_b_mint: Pubkey,
    token_b_amount: u64, // how much token b maker wants in exchange to their funds
    offer_id: u64, // for testing we will just rand it. else client will increment it 
    bump: u8 // this will be used to in take offer to invoke sign while we transfer from vault to
    // taker. bump is need. to avoid doing find_program_address() computes we store this
}


#[derive(BorshDeserialize, BorshSerialize)]
enum EscrowInsruction {
    InitializeOffer {
        token_a_amount:  u64,
        token_b_amount:  u64, // amount he wants
        offer_id: u64,
    },
    TakeOffer
}


fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data : &[u8]
) -> Result<(), ProgramError>{
    
    let mut iter = accounts.iter();

    let response = EscrowInsruction::try_from_slice(instruction_data)?;
   
    match response {
        EscrowInsruction::InitializeOffer { token_a_amount, token_b_amount, offer_id }=> {
            let maker = next_account_info(&mut iter)?; // the one called the makeOffer
            let token_a_mint = next_account_info(&mut iter)?;
            let token_b_mint = next_account_info(&mut iter)?;
            let offer_pda_account = next_account_info(&mut iter)?;
            let pda_ata_info= next_account_info(&mut iter)?;
            let maker_ata_a_info= next_account_info(&mut iter)?;
            let token_program= next_account_info(&mut iter)?; // required to create ata
            let system_program = next_account_info(&mut iter)?;
            let ata_program = next_account_info(&mut iter)?; 


            
            if !maker.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }

            if token_a_amount == 0 || token_b_amount == 0 {
                return Err(ProgramError::InvalidArgument);
            }

                
            let (pda, bump) = Pubkey::find_program_address(&[b"escrow", maker.key.as_ref(), offer_id.to_le_bytes().as_ref()], program_id);
           
        
            if pda != *offer_pda_account.key { // if the offer_pda_account is not as same as the
                // derived from same seeds
                return Err(ProgramError::InvalidArgument)
            }
            
            let rent = Rent::get()?;
            let required_rent= rent.minimum_balance(113);

            let i = create_account(
                maker.key, 
                &pda,  
                required_rent,   
                113, 
                program_id);
    
            // acutally calling the system program to create the account
            // invoke_signed is used for creating pda to know that this program is signing on
            // behalf of that pda
            // invoke is used when we know that the txn signer holds a private key
             invoke_signed(&i, 
                &[ // only passing accounts required by the system program not all accounts to
                    // avoid computes
                    maker.clone(),
                    offer_pda_account.clone(),
                    system_program.clone()
                ], 
                &[&[b"escrow", maker.key.as_ref(), offer_id.to_le_bytes().as_ref(), &[bump]]])?;
            

            // no need to to get bytes and upate them since they will 0 on this fresh pda
            let vault = Vault { 
                maker: *maker.key, 
                token_a_mint: *token_a_mint.key, 
                token_b_mint: *token_b_mint.key, 
                token_b_amount , 
                offer_id ,
                bump 
            };

            vault.serialize(&mut *offer_pda_account.data.borrow_mut())?;// put this vault data to 
            // offer_pda_account
    

            // not checking if ata of this vault exist since everytime we will create one pda and
            // close it and mathematically its impossible to exist already

            // create ata for this offer pda / or vault to store the maker funds
          let create_ata_offer_ix = create_associated_token_account(
                maker.key, 
                offer_pda_account.key, 
                token_a_mint.key, 
                token_program.key
            );

           invoke(
                &create_ata_offer_ix, 
                &[
                maker.clone(), // payer
                offer_pda_account.clone(), // vault
                token_a_mint.clone(),
                pda_ata_info.clone(),
                token_program.clone(),
                system_program.clone(),
                ata_program.clone()
                ] 
            )?; 

            let maker_ata = get_associated_token_address(maker.key, token_a_mint.key);

            if *maker_ata_a_info.key != maker_ata {
                return Err(ProgramError::InvalidArgument);
            }

            let pda_ata_account = get_associated_token_address(offer_pda_account.key, token_a_mint.key);
    
            // transfer the maker funds to ata
            let transfer_instruction = transfer(
                token_program.key,
                &maker_ata, // source (should be the ata account not the ata owner address)
                &pda_ata_account, // destination 
                maker.key, 
                &[maker.key],
                token_a_amount
            )?;

            invoke(&transfer_instruction, 
                &[
                    maker_ata_a_info.clone(),
                    pda_ata_info.clone(), // destination
                    maker.clone(),
                    token_program.clone(),
                ] 
            )?;
        


            let amount_vault= Account::unpack(&pda_ata_info.data.borrow())?.amount;

            msg!("amount in vault {}", amount_vault); // check this from tx.logs in client
           
        }
        EscrowInsruction::TakeOffer => { 
            let maker = next_account_info(&mut iter)?; // the one called the makeOffer
            let taker_account = next_account_info(&mut iter)?;
            let token_a_mint = next_account_info(&mut iter)?;
            let token_b_mint = next_account_info(&mut iter)?;
            let offer_pda_account = next_account_info(&mut iter)?;
            let pda_ata_info= next_account_info(&mut iter)?;
            let maker_ata_b_info= next_account_info(&mut iter)?;
            let taker_ata_token_b_info= next_account_info(&mut iter)?;
            let taker_ata_token_a_info= next_account_info(&mut iter)?;
            let token_program= next_account_info(&mut iter)?; // required to create ata
            let system_program = next_account_info(&mut iter)?;
            let ata_program = next_account_info(&mut iter)?; 

            let offer_vault = Vault::try_from_slice(&offer_pda_account.data.borrow())?;

            if offer_pda_account.owner != program_id { // check
                // if the pda account passed is correct
               return Err(ProgramError::InvalidArgument); 
            }

            if !taker_account.is_signer {
                return  Err(ProgramError::MissingRequiredSignature);
            }

            // check if this is the correct token 
            if *token_b_mint.key != offer_vault.token_b_mint || *token_a_mint.key != offer_vault.token_a_mint{
                return Err(ProgramError::InvalidArgument);
                }

            // check if the taker is indeed accessing the right vault_account_pda that they passed
            let pda = Pubkey::create_program_address(&[
                b"escrow", 
                offer_vault.maker.as_ref(),  // using the maker account from the vault. since
                // caller can pass anything as maker account
                offer_vault.offer_id.to_le_bytes().as_ref(),
                &[offer_vault.bump]
            ], 
                program_id
            )?;

            if pda != *offer_pda_account.key {
                return  Err(ProgramError::InvalidArgument);
            }

            if *maker.key != offer_vault.maker {
                return  Err(ProgramError::InvalidArgument);
            }

            if *maker_ata_b_info.key != get_associated_token_address(maker.key, token_b_mint.key) {
                return Err(ProgramError::InvalidArgument);
            }

            // if amount is correct then first create check ata for the maker or create one
            let ata_instruction = create_associated_token_account_idempotent(
                taker_account.key, 
                maker.key, 
                token_b_mint.key,
                token_program.key);

            let maker_ata_token_b = get_associated_token_address(maker.key, token_b_mint.key);

            invoke(
                &ata_instruction, 
                &[
                    taker_account.clone(),// payer
                    maker.clone(), // needed since we creating for maker
                    maker_ata_b_info.clone(), // the account that is being created
                    token_b_mint.clone(),
                    token_program.clone(),
                    ata_program.clone(),
                    system_program.clone(),
                ]
            )?;
            
            let taker_ata_token_b = get_associated_token_address(taker_account.key, token_b_mint.key);
            if *taker_ata_token_b_info.key != taker_ata_token_b {
                return Err(ProgramError::InvalidArgument);
            }
            
            // TAKER FUNDS TO MAKER 
            let transfer_instruction = transfer(
                &spl_token::id(), 
                &taker_ata_token_b, 
                &maker_ata_token_b, 
                taker_account.key, 
                &[taker_account.key], 
                offer_vault.token_b_amount
            )?;

            invoke(&transfer_instruction, 
                &[
                    taker_ata_token_b_info.clone(),
                    maker_ata_b_info.clone(), // transfer to maker ata b
                    taker_account.clone(),
                    token_program.clone(),

                ]
            )?;

    
            // TAKER GET VAULT FUNDS
            // create ata of token_a for taker
            invoke(
                &create_associated_token_account_idempotent(
                    taker_account.key, 
                    taker_account.key,
                    token_a_mint.key, 
                    &spl_token::id()), 

                &[
                   taker_account.clone(), // payer
                    taker_ata_token_a_info.clone(),
                   taker_account.clone(), // owner
                    token_a_mint.clone(),
                    system_program.clone(),
                    ata_program.clone(),
                    token_program.clone(),
                ]
            )?;
           
            let pda_ata_account = get_associated_token_address(offer_pda_account.key, token_a_mint.key);
            
            if *pda_ata_info.key != pda_ata_account || pda_ata_info.owner != token_program.key{
                return  Err(ProgramError::InvalidArgument);
            }
            let vault_ata = Account::unpack(&pda_ata_info.data.borrow())?;

            if vault_ata.owner != *offer_pda_account.key {
                return  Err(ProgramError::InvalidArgument);
            }


            // we need the pda AccountInfo here . so client must pass it while calling
            let locked_funds_amount = Account::unpack(&pda_ata_info.data.borrow())?.amount;
            let taker_ata_token_a = get_associated_token_address(taker_account.key, token_a_mint.key);

            if *taker_ata_token_a_info.key != taker_ata_token_a {
                return Err(ProgramError::InvalidArgument);
            }
            let taker_token_a_balance_before= Account::unpack(&taker_ata_token_a_info.data.borrow())?.amount;

                
            msg!("locked_funds_amount before transfer {}", locked_funds_amount);
            msg!("taker token_a funds before transfer {}", taker_token_a_balance_before);

            let funds_transfer_ix = transfer(
                &spl_token::id(), 
                &pda_ata_account,
                &taker_ata_token_a, 
                offer_pda_account.key, 
                &[], 
                locked_funds_amount)?;

            invoke_signed(
                &funds_transfer_ix, 
                &[
                   pda_ata_info.clone(), // vault
                   taker_ata_token_a_info.clone(),
                   offer_pda_account.clone(),
                   token_program.clone(),
                ], 
                &[&[b"escrow", offer_vault.maker.as_ref(), offer_vault.offer_id.to_le_bytes().as_ref(), &[offer_vault.bump]]])?;


            let locked_funds_after = Account::unpack(&pda_ata_info.data.borrow())?.amount;
            let taker_balance_after = Account::unpack(&taker_ata_token_a_info.data.borrow())?.amount;

            msg!("vault after: {}", locked_funds_after);
            msg!("taker after: {}", taker_balance_after);
            

            // closing the vault account ata 
            // rent goes to taker
            invoke_signed(
                &close_account(
                token_program.key, 
                pda_ata_info.key, 
                taker_account.key, 
                offer_pda_account.key, 
                &[])?, 

                &[
                    pda_ata_info.clone(),
                    taker_account.clone(),
                    offer_pda_account.clone(),
                ], 

                &[&[b"escrow", offer_vault.maker.as_ref(), offer_vault.offer_id.to_le_bytes().as_ref(), &[offer_vault.bump]]])?;


            // closign the offer Pda. rent goes to maker
            let lamports = offer_pda_account.lamports();

            offer_pda_account.realloc(0, true)?;

            **offer_pda_account.lamports.borrow_mut() = 0;
            **maker.lamports.borrow_mut() += lamports;

            // relloc 0 data 

            offer_pda_account.assign(system_program.key);
        }

    }
    
    Ok(())
}
