///
/// aptos move compile --named-addresses aptos_verifier=default
///

module aptos_verifier::verifier {
    use aptos_std::crypto_algebra::{
        Element,
        from_u64,
        multi_scalar_mul,
        eq,
        pairing,
        add,
        zero
    };
    use aptos_std::table::{Table, Self};
    use aptos_std::table_with_length::{TableWithLength, Self};
    use std::simple_map::{SimpleMap, Self};
    use std::string::{String, utf8, Self};
    use std::vector;
    use std::signer;
    use std::bcs;
    use std::event;
    use aptos_std::string_utils::{to_string};

    use aptos_token_objects::token::{Self, Token, create_token_address};
    use aptos_token_objects::collection;
    
    use std::option::{Self, Option};
    use aptos_framework::object;

    struct Game has key, store {
        professor_address: address,
        questions: vector<Quest>,
        profiles: Table<address, UserProfile>,
        answers: Table<UserQuest, Answer>,
        num_prizes: u64,
    }

    struct GameRegistry has key, store {
        games: vector<Game>
    }

    struct Answer has store, drop {
        quest: u64,
        student_a_hash: vector<u8>,
        student_aH_x: vector<u8>,
        student_aH_y: vector<u8>,
        timestamp_answered: u64, //Deal with it later
        student_address: address,
        akP_x: vector<u8>,
        akP_y: vector<u8>
    }

    struct UserQuest has drop, copy, store {
        user: address,
        quest: u64,
    }

    struct UserProfile has key, store {
        level: u64,
        answered_right: vector<u64>,
        wrong_attempts: SimpleMap<u64, u64>
    }

    struct Quest has key, store {
        points: u64,
        game: u64,
        winners: Table<address, bool>,
        //for_level: u64,
        question: String,
        image_blob: String,
        professor_address: address,
        professor_k_hash: vector<u8>,
        professor_kP_x: vector<u8>,
        professor_kP_y: vector<u8>
    }

    #[event]
    struct GameCreatedEvent has drop, store {
        game_number_in_registry: u64
    }

    //Create a collection for reward Tokens on init
    //Create an empty registry of games and give it to publisher
    fun init_module(deployer: &signer) {
        let royalty = option::none();

        collection::create_unlimited_collection(
            deployer,
            utf8(b"Aptly is a unique zk gaming technology."),
            utf8(b"Aptly zkPrizes"),
            royalty,
            utf8(b"https://aptly-zk.netlify.app"),
        );

        move_to(
            deployer,
            GameRegistry {
                games: vector::empty()
                //coins: coin::zero(),
            }
        );
    }

    public entry fun professor_create_game(user: &signer) acquires GameRegistry {
        let professor_address = signer::address_of(user);

        let game_registry = borrow_global_mut<GameRegistry>(professor_address);

        let game = Game {
            num_prizes : 0,
            profiles: table::new(),
            professor_address: professor_address,
            questions: vector::empty(),
            answers: table::new()
        };
        vector::push_back(&mut game_registry.games, game);
        let game_number_in_registry = vector::length(&mut game_registry.games);
   
        //Emit event with the current number in the vector
        event::emit(
            GameCreatedEvent { game_number_in_registry }
        );

    }

    const EInsufficientCollateral: u64  = 7;
    const EStudentInvalidCommitment: u64 = 8;

    public entry fun student_answer_question(user: &signer, registry_address: address, game_number: u64, quest_number: u64, proof_commit_a: vector<u8>,
    proof_commit_b: vector<u8>, proof_commit_c: vector<u8>,
     student_a_hash: vector<u8>, student_aH_x: vector<u8>, student_aH_y: vector<u8>, 
     proof_unlock_a: vector<u8>, proof_unlock_b: vector<u8>, proof_unlock_c: vector<u8>,  akP_x: vector<u8>, akP_y: vector<u8>)
    acquires GameRegistry
    {
        //Retrieve all needed objects
        let student_address = signer::address_of(user);
        let game_registry = borrow_global_mut<GameRegistry>(registry_address);
        let game = vector::borrow_mut(&mut game_registry.games, game_number);
        let Quest {game: _, winners, question: _, points: _, image_blob: _, professor_address, professor_k_hash: _,
            professor_kP_x, professor_kP_y} = vector::borrow_mut(&mut game.questions, quest_number);

        //Check that the user did not yet win this question
        assert!(!table::contains(winners, student_address), 94411);

        //TODO: Take 1 APT for the mint anyway
        //Send it to professor address, retrieved for Quest object
        //!!!Enable mimimal collateral during production to avoid spammers!!!
        
        //Check that I did not answer already i.e Answers map does not have caller address key
        let has_place = !table::contains<UserQuest, Answer>(&game.answers, 
         UserQuest{ quest: quest_number , user: student_address});
        assert!(has_place, EStudentNoAnswer);

        //student_addr_serialized with first byte (least significant) flushed to make it fit 253-bit curve base field
        let student_addr_serialized = bcs::to_bytes(&student_address);
        let last_byte = vector::borrow_mut(&mut student_addr_serialized, 31);
        *last_byte = 0;

        //Verify commitment, indeed multiplied preimage of hash by some secret point to get aH_x, aH_y
        let is_valid_commitment = commit(proof_commit_a, proof_commit_b, proof_commit_c, student_a_hash, student_aH_x, student_aH_y, student_addr_serialized);
        assert!(is_valid_commitment, EStudentInvalidCommitment);

        //Verify that public professors kP_x, kP_y was indeed multiplied by some secret a, matching student's public commitment hash_a
        let is_valid_multiplication = unlock(proof_unlock_a, proof_unlock_b, proof_unlock_c, akP_x, akP_y, 
        student_addr_serialized, student_a_hash, *professor_kP_x, *professor_kP_y);
        assert!(is_valid_multiplication, EStudentBadMultiplication);

        //TODO: Add right timestamp here later
        //It is needed to give user the right to return collateral when the oracle is down (timeouts)
        let timestamp_answered = 0;

        //Write this verified commitment to answer
        //Write this verified multiplication result to answer
        let answer = Answer {
            quest: quest_number,
            student_a_hash, 
            student_aH_x,   
            student_aH_y,   
            timestamp_answered, //Deal with it later
            student_address,
            akP_x,          
            akP_y,
        };
        if (has_place) table::add(&mut game.answers, 
        UserQuest{ quest: quest_number , user: student_address}, answer);

        //(Insight) when the price is not enough to reduce bots
        //Can be easily limited to one try per address
        //Or completely unique one-time questions can be made
        //Or whitelisting might be done
        //Or keyless accounts verified with GMail
        //Or different scheme with frozen collateral can be made
    }

    use aptos_std::bn254_algebra::{
        Fr,
        FormatFrLsb,
        FormatG1Compr,
        FormatG2Compr,
        G1,
        G2,
        Gt,
    };
    use aptos_std::crypto_algebra::{deserialize};

    //A helper function to get the right image for the right level prizes
    public fun get_blob_from_number(num: u64): String {
        let static_map: vector<String> = vector[
            utf8(b"0"),
            utf8(b"https://arty-arty.github.io/Bronze.svg"),
            utf8(b"2"),
            utf8(b"https://arty-arty.github.io/Silver.svg"),
            utf8(b"4"),
            utf8(b"5"),
            utf8(b"6"),
            utf8(b"https://arty-arty.github.io/Gold.svg"),
            utf8(b"8"),
            utf8(b"9"),
            utf8(b"https://arty-arty.github.io/Diamond.svg"),
        ];

        if (num < vector::length(&static_map)) {
            *vector::borrow(&static_map, num)
        } else {
            utf8(b"Invalid")
        }
    }

    public entry fun professor_score_answer(user: &signer, quest_number: u64, game_number: u64, student: address, 
    proof_a:vector<u8>, proof_b:vector<u8>, proof_c:vector<u8>,
    professor_out_kaH_x: vector<u8>, professor_out_kaH_y: vector<u8>) acquires GameRegistry
    {
        //Retrieve all needed object
        let _professor_address = signer::address_of(user);
        let game_registry = borrow_global_mut<GameRegistry>(_professor_address);
        let game = vector::borrow_mut(&mut game_registry.games, game_number);
        let Quest {game: _, winners, question: _, points, image_blob: _, professor_address, professor_k_hash,
            professor_kP_x, professor_kP_y} = vector::borrow_mut(&mut game.questions, quest_number);
        let answers = &mut game.answers;
       
        //Assert that this question belongs to this professor
        assert!(_professor_address == *professor_address, EAnotherProfessor);

        //professor_addr_serialized with first byte (least significant) flushed to make it fit 253-bit curve base field
        let professor_addr_serialized = bcs::to_bytes(&_professor_address);
        let last_byte = vector::borrow_mut(&mut professor_addr_serialized, 31);
        *last_byte = 0;

        //Assert that this student answered indeed
        assert!(table::contains(answers, UserQuest{ quest: quest_number , user: student}), EStudentNoAnswer);

        //Extract his answer
        let student_answer = table::borrow(answers, UserQuest{ quest: quest_number , user: student});

        let student_aH_x = student_answer.student_aH_x;
        let student_aH_y = student_answer.student_aH_y;
        let student_address = student_answer.student_address;

        //Do verified multiplication of student aH by k
        let multiplied = unlock(proof_a, proof_b, proof_c, professor_out_kaH_x, professor_out_kaH_y, 
        professor_addr_serialized, *professor_k_hash, student_aH_x, student_aH_y);

        //Assert it was verified groth16 proven
        assert!(multiplied, EProfessorBadMultiplication);

        //If verified professor_final point matches student_final_point
        let right_answer: bool = (professor_out_kaH_x == student_answer.akP_x) && (professor_out_kaH_y == student_answer.akP_y);
        
        let profiles = &mut game.profiles;
        //If user has no profile create his profile
        if (!table::contains(profiles, student))
        {
            let new_profile = UserProfile {
                level: 0,
                answered_right: vector::empty(),
                wrong_attempts: simple_map::new(),
            };
            table::add(profiles, student, new_profile); 
        };
        let profile = table::borrow_mut(profiles, student);
            
        if(right_answer){
            //Add the user to the winners list
            table::add(winners, student, true);

            //Update user profile
            profile.level = profile.level + *points;
            vector::push_back(&mut profile.answered_right, quest_number);
            
            //If profile is good enough send the user a new unlocked achievement NFT
            if (profile.level==1 || profile.level == 3 || profile.level ==7 || profile.level == 10)
            //Mint the prize NFT to the student
            {
                game.num_prizes = game.num_prizes + 1;
                let token_name = utf8(b"zkPrize #");
                let collection_name = utf8(b"Aptly zkPrizes");
                string::append(&mut token_name, to_string(&game_number));
                string::append(&mut token_name, utf8(b" #"));
                string::append(&mut token_name, to_string(&game.num_prizes));
                let royalty = option::none();
                let token = token::create_named_token(
                    user,
                    collection_name,
                    utf8(b"At this level you get a new prize certified by zk. Get to the top level for the VIP prize."),
                    token_name,
                    royalty,
                    get_blob_from_number(profile.level),
                );

                //Send the prize token to the winner
                let token_addr = create_token_address(professor_address, &collection_name, &token_name);
                let token = object::address_to_object<Token>(token_addr);
                object::transfer<Token>(user, token, student_address);
            };
              
        } else{
            //In case of wrong answer, increase the number of wrong attempts for this quest in the profile
            if (!simple_map::contains_key(&profile.wrong_attempts, &quest_number))
             simple_map::add(&mut profile.wrong_attempts, quest_number, 0 ) ;
            let wrong_attempts_n = simple_map::borrow_mut(&mut profile.wrong_attempts, &quest_number);
            *wrong_attempts_n = *wrong_attempts_n + 1;
        };
        
        //Pop the answer from answers table anyway
        table::remove(answers, UserQuest{ quest: quest_number , user: student});       
    }

    //ZKP verification code based on Aptos Labs Github, with our commit and unlock verification keys inserted
    fun commit(
        proof_a_ser: vector<u8>,
        proof_b_ser: vector<u8>,
        proof_c_ser: vector<u8>,
        public_out_hash_a: vector<u8>,
        public_out_aP_x: vector<u8>,
        public_out_aP_y: vector<u8>,
        public_in_address: vector<u8>
    ): bool {

        let vk_alpha_g1 =
            std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2d"
                )
            );
       
        let vk_beta_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789"
                )
            );
        
        let vk_gamma_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19"
                )
            );
        let vk_delta_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"f1555ee802f49f17c1ded7f8e0a35efd4a7caa5c66b14c5de3bc15e7ac579e02350ae505a137c6dd2a84365a88f2771ab96e4e33c0fdaf5b58ca9cf852804587"
                )
            );
        let vk_gamma_abc_g1: vector<Element<G1>> = vector[
            std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"d05232298846333af5b9c786e300fb364e8f91277dfbd9113761976ef811bd8a"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"e05f5921e1ea4e7a81d8e1217b553562139326591186de5ad755c02ca9519e2a"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"2c8cd74dd2ca1759a54bcfd8d6bb03fcc2fc185ea98112e22fd667275112c720"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"2c27f5c74e447fb310add441802dfa1d53bc87297703e7a90d0438166a2ab6a8"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"7b2099a5ca41e6c4c88a00eee53d4bd51c95d13cb8d03d19fa68352e59e9d997"
                )
            )
        ];
         
        let public_inputs: vector<Element<Fr>> = vector[
            std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_out_hash_a)
            ),
            std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_out_aP_x)
            ),
            std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_out_aP_y)
            ),
            std::option::extract(&mut deserialize<Fr, FormatFrLsb>(&public_in_address)) // Assuming this is already in vector<u8>
        ];

        let proof_a =
            std::option::extract(&mut deserialize<G1, FormatG1Compr>(&proof_a_ser));
        let proof_b =
            std::option::extract(&mut deserialize<G2, FormatG2Compr>(&proof_b_ser));
        let proof_c =
            std::option::extract(&mut deserialize<G1, FormatG1Compr>(&proof_c_ser));

        let verification_result: bool =
            verify_proof<G1, G2, Gt, Fr>(
                &vk_alpha_g1,
                &vk_beta_g2,
                &vk_gamma_g2,
                &vk_delta_g2,
                &vk_gamma_abc_g1,
                &public_inputs,
                &proof_a,
                &proof_b,
                &proof_c
            );

        verification_result
    }

    fun unlock(
        proof_a_ser: vector<u8>,
        proof_b_ser: vector<u8>,
        proof_c_ser: vector<u8>,
        public_out_kaH_x: vector<u8>,
        public_out_kaH_y: vector<u8>,
        public_in_address: vector<u8>,
        public_in_hash_k: vector<u8>,
        public_in_aH_x: vector<u8>,
        public_in_aH_y: vector<u8>
    ): bool {
        
        let vk_alpha_g1 =
            std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2d"
                )
            );
        
        let vk_beta_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"abb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789"
                )
            );
        
        let vk_gamma_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19"
                )
            );

        let vk_delta_g2 =
            std::option::extract(
                &mut deserialize<G2, FormatG2Compr>(
                    &x"887208fad3f8550e15bf3215798913226934b2d643d5a5f9c34a048aa168172467d50cca4f282065b87d49e7bc3e06b50b3675c66a1c2db2fedd8cbeed76ae2b"
                )
            );

        let vk_gamma_abc_g1: vector<Element<G1>> = vector[
            std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"d05232298846333af5b9c786e300fb364e8f91277dfbd9113761976ef811bd8a"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"87f7c971b71d490782ad5a062ba629c632d23a8c32ccccbd6f90eef0706f4dae"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"0de6bf1b29e90ec277a567aa9582c21e84322e41eb92789b0bec360a94061887"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"494fd99769977a167bced33324f2e2fd654f141dc77844d8375e2d2d6bb55890"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"c863813be5a227e8cc56108364ec7b07228479a299c26da09771ccb3b31a4a07"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"4616f0b4ea057686c6fd2d5bffbd4165a352e61744f2b27a971952ace6a98810"
                )
            ), std::option::extract(
                &mut deserialize<G1, FormatG1Compr>(
                    &x"61021a3b9efae96006b4e0334b7c0a437e941ebf91de9981acba5608b3825a08"
                )
            )
        ];

        let public_inputs: vector<Element<Fr>> = vector[
            std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_out_kaH_x)
            ), std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_out_kaH_y)
            ), std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_in_address)
            ), // Assuming public_in_address is already a `vector<u8>`
            std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_in_hash_k)
            ), std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_in_aH_x)
            ), std::option::extract(
                &mut deserialize<Fr, FormatFrLsb>(&public_in_aH_y)
            )
        ];

        let proof_a =
            std::option::extract(&mut deserialize<G1, FormatG1Compr>(&proof_a_ser));
        let proof_b =
            std::option::extract(&mut deserialize<G2, FormatG2Compr>(&proof_b_ser));
        let proof_c =
            std::option::extract(&mut deserialize<G1, FormatG1Compr>(&proof_c_ser));

        let verification_result: bool =
            verify_proof<G1, G2, Gt, Fr>(
                &vk_alpha_g1,
                &vk_beta_g2,
                &vk_gamma_g2,
                &vk_delta_g2,
                &vk_gamma_abc_g1,
                &public_inputs,
                &proof_a,
                &proof_b,
                &proof_c
            );

        verification_result
    }

    const EInvalidCommitment: u64 = 0;
    //const EInvalidUnlock: u64 = 1;
    const EAnotherProfessor: u64 = 2;
    const EStudentNoAnswer: u64 = 3;
    const EProfessorBadMultiplication: u64 = 4;
    const EStudentBadMultiplication: u64 = 5;
    const EYouAreTheWrongProfessor : u64 = 9;

    public entry fun professor_create_quest(
        user: &signer,
        game_number_in_registry: u64,
        points: u64,
        image_blob: vector<u8>,
        question: vector<u8>,
        proof_a_ser: vector<u8>,
        proof_b_ser: vector<u8>,
        proof_c_ser: vector<u8>,
        professor_k_hash: vector<u8>,
        professor_kP_x: vector<u8>,
        professor_kP_y: vector<u8>
    ) acquires GameRegistry {
        let professor_address = signer::address_of(user);
        let game_registry = borrow_global_mut<GameRegistry>(professor_address);

        let game = vector::borrow_mut(&mut game_registry.games, game_number_in_registry);

        //Assert that professor can edit this shared object, because he created it
        assert!(game.professor_address == professor_address, EYouAreTheWrongProfessor);

        //professor_addr_serialized with first byte (least significant) flushed to make it fit 253-bit curve base field
        let professor_addr_serialized = bcs::to_bytes(&professor_address);
        let last_byte = vector::borrow_mut(&mut professor_addr_serialized, 31);
        *last_byte = 0;

        //Immediately asserts that professot commitment is valid
        //(He used this hashed k to multiply by private input P and got public kP_x, kP_y)
        let is_valid: bool =
            commit(
                proof_a_ser,
                proof_b_ser,
                proof_c_ser,
                professor_k_hash,
                professor_kP_x,
                professor_kP_y,
                professor_addr_serialized
            );
        assert!(is_valid, EInvalidCommitment);

        //Only then creates an object - quest
        //Adds it to the relevant game questions list
        //Writes question text, k_hash, kP_x, kP_y
        //Auto write professor address
        let quest = Quest {
            winners: table::new(),
            points: points,
            game: game_number_in_registry,
            question: utf8(question),
            image_blob: utf8(image_blob),
            professor_address,
            professor_k_hash,
            professor_kP_x,
            professor_kP_y
        };
        vector::push_back(&mut game.questions, quest);
    }

    // This fragment for the actual ZKP verification on ECs is taken as written in the Aptos Labs ZKP groth16 example
    // /// Proof verification as specified in the original paper,
    // /// with the following input (in the original paper notations).
    // /// - Verification key: $\left([\alpha]_1, [\beta]_2, [\gamma]_2, [\delta]_2, \left\\{ \left[ \frac{\beta \cdot u_i(x) + \alpha \cdot v_i(x) + w_i(x)}{\gamma} \right]_1 \right\\}\_{i=0}^l \right)$.
    // /// - Public inputs: $\\{a_i\\}_{i=1}^l$.
    // /// - Proof $\left( \left[ A \right]_1, \left[ B \right]_2, \left[ C \right]_1 \right)$.
    public fun verify_proof<G1, G2, Gt, S>(
        vk_alpha_g1: &Element<G1>,
        vk_beta_g2: &Element<G2>,
        vk_gamma_g2: &Element<G2>,
        vk_delta_g2: &Element<G2>,
        vk_uvw_gamma_g1: &vector<Element<G1>>,
        public_inputs: &vector<Element<S>>,
        proof_a: &Element<G1>,
        proof_b: &Element<G2>,
        proof_c: &Element<G1>
    ): bool {
        let left = pairing<G1, G2, Gt>(proof_a, proof_b);
        let scalars = vector[from_u64<S>(1)];
        std::vector::append(&mut scalars, *public_inputs);
        let right = zero<Gt>();
        let right = add(
            &right,
            &pairing<G1, G2, Gt>(vk_alpha_g1, vk_beta_g2)
        );
        let right =
            add(
                &right,
                &pairing(&multi_scalar_mul(vk_uvw_gamma_g1, &scalars), vk_gamma_g2)
            );
        let right = add(&right, &pairing(proof_c, vk_delta_g2));
        eq(&left, &right)
    }
}