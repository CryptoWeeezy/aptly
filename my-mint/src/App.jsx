import React, { useState, useEffect, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";
import { ZqField, Scalar } from "ffjavascript";
import { string_to_curve } from "../../boneh-encode/hash_to_curve.mjs";
import * as wasm from "../../ark-serializer/pkg/ark_serializer_bg.wasm";
import { __wbg_set_wasm } from "../../ark-serializer/pkg/ark_serializer_bg.js";
import {
  proof_serialize,
  public_input_serialize,
} from "../../ark-serializer/pkg/ark_serializer_bg.js";
import { WalletSelector as AntdWalletSelector } from "@aptos-labs/wallet-adapter-ant-design";
import { AptosConfig, Aptos, Account, Network, Ed25519PrivateKey, U64, MoveVector } from '@aptos-labs/ts-sdk';
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
import { Tooltip as ReactTooltip } from 'react-tooltip'; // Import as named export

// Create both Aptos client
const config_testnet = new AptosConfig({ network: Network.TESTNET });
const config_mainnet = new AptosConfig({ network: Network.MAINNET });
const aptos_testnet = new Aptos(config_testnet);
const aptos_mainnet = new Aptos(config_mainnet);

//Generate a random one-time key to multiply by professors result
const r = Scalar.fromString(
  "2736030358979909402780800718157159386076813972158567259200215660948447373041"
);
const F = new ZqField(r);

//Get .move package on Aptos address from .env
const verifier_pkg = process.env.packageId + "::verifier";
const quest_ids = process.env.questIds;

const game_id_testnet = process.env.gameId;
const game_id_mainnet = process.env.gameIdMainnet;


console.log({ verifier_pkg, quest_ids });

//A function where the main mathematical work happens
//Here we prove the arithmetic circuits with snarkjs, serialize the data with ark-works
//And send transaction to Aptos network smart contract
async function answer_quest(snarkjs, addr, quest_id, student_answer, gameObject) {
  const student_key = F.random().toString();
  const game_id = gameObject?.id;

  //Encode the answer to a point on elliptic curve using try-and-increment method
  const { xx: student_H_x, yy: student_H_y } = string_to_curve(student_answer);

  const addr_for_proof = addr_to_bigint(addr).toString();
  console.log(addr_for_proof);

  //BEGIN: Generate commit proof for student answer point on elliptic curve//
  const { proof: proof_commit, publicSignals: publicSignals_commit } =
    await snarkjs.groth16.fullProve(
      {
        address: addr_for_proof,
        a: student_key,
        P_x: student_H_x,
        P_y: student_H_y,
      },
      "compiled_circuits/commit_main.wasm",
      "compiled_circuits/commit_main.groth16.zkey"
    );
  console.log({
    student_H_x,
    student_H_y,
    proof: JSON.stringify(proof_commit),
    publicSignals_commit,
  });

  const { proof_a: proof_commit_a, proof_b: proof_commit_b, proof_c: proof_commit_c } = JSON.parse(proof_serialize_by_parts(JSON.stringify(proof_commit)));
  console.log({ proof_commit_a, proof_commit_b, proof_commit_c });

  //Now serialzie with my ark-serialize the public inputs
  const signals_commit = publicSignals_commit.map((input) =>
    public_input_serialize(input)
  );
  console.log({ signals_commit });

  const [student_a_hash_int, student_aH_x_int, student_aH_y_int] =
    publicSignals_commit;
  const [student_a_hash, student_aH_x, student_aH_y] = signals_commit;
  console.log(student_a_hash, student_aH_x, student_aH_y);
  //END: Generate commit proof for student answer point on elliptic curve//

  //Here we must retrieve from Aptos api professor_kP_x and professor_kP_y written in this shared Quest object
  //And convert this vector<u8> array the right way into a number for the proving system
  //make it professor_kP_x_int, professor_kP_y_int

  const { professor_kP_x, professor_kP_y } = gameObject.questions[quest_id]
  console.log({ professor_kP_x, professor_kP_y });

  //Convert bytes to utf-8 string
  //Then decode this hex encoded string to bytes
  //Take those bytes and convert to number
  //Take into account that the first byte is the least significant byte
  const professor_kP_x_int = utf8_hex_to_int(professor_kP_x).toString();
  const professor_kP_y_int = utf8_hex_to_int(professor_kP_y).toString();

  console.log({
    //quest_object,
    professor_kP_x,
    professor_kP_y,
    professor_kP_x_int,
    professor_kP_y_int,
  });

  //BEGIN: Generate unlock proof of student- proof she multiplied professors point with her same key
  const { proof: proof_unlock, publicSignals: publicSignals_unlock } =
    await snarkjs.groth16.fullProve(
      {
        address: addr_for_proof,
        k: student_key,
        hash_k: student_a_hash_int,
        aH_x: professor_kP_x_int,
        aH_y: professor_kP_y_int,
      },
      "compiled_circuits/unlock_main.wasm",
      "compiled_circuits/unlock_main.groth16.zkey"
    );
  console.log({ proof: JSON.stringify(proof_unlock), publicSignals_unlock });

  const { proof_a: proof_unlock_a, proof_b: proof_unlock_b, proof_c: proof_unlock_c } =
    JSON.parse(proof_serialize_by_parts(JSON.stringify(proof_unlock)));
  console.log({ proof_unlock_a, proof_unlock_b, proof_unlock_c });

  //Now serialzie with my ark-serialize the public inputs
  const signals_unlock = publicSignals_unlock.map((input) =>
    public_input_serialize(input)
  );
  console.log({ signals_unlock });

  const [akP_x, akP_y, , ,] = signals_unlock;
  console.log({ akP_x, akP_y });
  //END: Generate unlock proof - proof of student multiplied professors point with her same key//

  //The Aptos smart contract methods signature is this, we construct the Txn accordingly
  // public entry fun student_answer_question(user: &signer, registry_address: address, game_number: u64, quest_number: u64, proof_commit_a: vector<u8>,
  //   proof_commit_b: vector<u8>, proof_commit_c: vector<u8>,
  //    student_a_hash: vector<u8>, student_aH_x: vector<u8>, student_aH_y: vector<u8>, 
  //    proof_unlock_a: vector<u8>, proof_unlock_b: vector<u8>, proof_unlock_c: vector<u8>,  akP_x: vector<u8>, akP_y: vector<u8>)
  const paramsDict = {
    proof_commit_a,
    proof_commit_b,
    proof_commit_c,
    student_a_hash,
    student_aH_x,
    student_aH_y,
    proof_unlock_a,
    proof_unlock_b,
    proof_unlock_c,
    akP_x,
    akP_y
  };

  console.log(paramsDict, game_id, quest_id);
  const tx = {
    function: verifier_pkg + "::student_answer_question",
    functionArguments: [
      verifier_pkg.split("::")[0],
      (parseInt(game_id, 10) - 1),
      quest_id,
      hex_to_movevector(proof_commit_a),
      hex_to_movevector(proof_commit_b),
      hex_to_movevector(proof_commit_c),
      hex_to_movevector(student_a_hash),
      hex_to_movevector(student_aH_x),
      hex_to_movevector(student_aH_y),

      hex_to_movevector(proof_unlock_a),
      hex_to_movevector(proof_unlock_b),
      hex_to_movevector(proof_unlock_c),

      hex_to_movevector(akP_x),
      hex_to_movevector(akP_y),
    ],
  };
  console.log({ tx });
  return tx;
}

import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { proof_serialize_by_parts } from "../../ark-serializer/pkg/ark_serializer.js";
import { addr_to_bigint, arrayToDict, compareAndNotify, hex_to_movevector, numberToAlphabet, utf8_hex_to_int } from "./helpers.jsx";

const Main = () => {
  //Initialize the state of react application with data we may want to track
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("Welcome! Your question is loading...");

  const [image, setImage] = useState("/question-mark.png");
  const [spinning, setSpinning] = useState(true);
  const [showPopup, setShowPopup] = useState(true);
  const [objects, setObjects] = useState([]);

  const [open, setOpen] = useState(false);
  const [gotIt, setGotIt] = useState(0);

  const [showConfetti, setShowConfetti] = useState(false);
  const { width, height } = useWindowSize(); // Get window size for confetti effect

  // Method to trigger confetti when the answer is right
  const triggerConfetti = () => {
    setShowConfetti(true);
    console.log("Triggered confetti!")
    setTimeout(() => setShowConfetti(false), 3000); // Stop after 3 seconds
  };

  //Load the wasm for my ark-serialzier module
  //It works fine without it in dev mode i.e (npm run dev)
  //But in production mode like on netlify vite "forgets" to do it, so we manually should init the module here
  useEffect(() => {
    __wbg_set_wasm(wasm);
    console.log("wasm set");
  }, []);

  //Use wallet hook given by AptosLabs to propose transactions and see current connected account address
  const { account, connected, changeNetwork, disconnect, network, signAndSubmitTransaction } = useWallet();
  const currentAccount = account;
  console.log({ currentAccount, network })

  //Initialize some other useful state variables for question tracking and answering
  const [level, setLevel] = useState(0);
  const [answeredRight, setAnsweredRight] = useState(null);
  const [answeredWrong, setAnsweredWrong] = useState(null);
  const [questNumber, setQuestNumber] = useState(1);
  const answeredWrongRef = useRef(answeredWrong); // Create a ref to hold the current value of answeredWrong
  const answeredRightRef = useRef(answeredRight);
  const [isShaking, setIsShaking] = useState(false);
  const [showRedOverlay, setShowRedOverlay] = useState(false);
  const [gameObject, setGameObject] = useState({ questions: [] });

  const handleWrongAnswer = () => {
    // Trigger shake and red overlay
    setIsShaking(true);
    setShowRedOverlay(true);

    // Stop the shake effect after 0.5s (duration of the shake animation)
    setTimeout(() => setIsShaking(false), 2 * 1000);

    // Stop the red overlay effect after 0.3s (duration of the blink animation)
    setTimeout(() => setShowRedOverlay(false), 2 * 1000);
  };

  const findFirstUnansweredQuestion = (quest_ids, answered_right, gameObject) => {
    // Loop through quest_ids and find the first one that isn't in answered_right
    for (let i = 0; i < gameObject.questions.length; i++) {
      if (!answered_right.includes(i.toString())) {
        // Return the question number (1-based index)
        console.log({switchtounanswered: i+1});
        return i + 1;
      }
    }
    // If all questions are answered
    return null; // or return a message like "All questions are answered"
  };

  //Here is every 2 seconds checker of a person's profile in this game
  useEffect(() => {
    const fetcher = async () => {
      const aptos = (network?.name=='testnet') ? aptos_testnet : aptos_mainnet;
      const game_id =  (network?.name=='testnet') ? game_id_testnet : game_id_mainnet;
      //Fetch the game object from the game registry
      const { games } = await aptos.getAccountResource({
        accountAddress: verifier_pkg.split(":")[0],
        resourceType: verifier_pkg + "::GameRegistry",
      })
      const gameObj = games[game_id - 1];
      console.log(gameObj);

      if (!gameObj) return;
      gameObj.id = game_id;
      setGameObject(gameObj);
      console.log({ gameObj });
      const profilesTableId = gameObj?.profiles?.handle;
      console.log({ profilesTableId });

      if (currentAccount.address) {

        //Fetch the current user profile from the Aptos table
        const tableItem = {
          key_type: "address",
          value_type: verifier_pkg + `::UserProfile`,
          key: currentAccount.address,
        };
        const profiles_table = await aptos.getTableItem({ handle: profilesTableId, data: tableItem });
        console.log(profiles_table);

        let { level, answered_right, wrong_attempts } = profiles_table || {};

        const wrong_array = wrong_attempts?.data;
        console.log({ level, answered_right, wrong_array });
        if (!answered_right) answered_right = [];
        const wrong_dict = arrayToDict(wrong_array);
        console.log({ wrong_dict })
        setLevel(level || 0);

        const onRightAnswer = (answeredRightRef.current) && (answeredRightRef.current?.length != answered_right?.length) && (answered_right?.length != 0);
        const onRightAnswerOrLoad = (answeredRightRef?.current?.length != answered_right?.length);

        console.log(answeredRightRef.current, answered_right);
        console.log(onRightAnswer);

        setAnsweredRight(answered_right);
        answeredRightRef.current = answered_right;

        //If possible switch to the first unanswered question
        if (onRightAnswerOrLoad) {
          console.log("Right answer or load happened")
          const to_question_num = findFirstUnansweredQuestion(quest_ids, answered_right, gameObj);
          console.log({to_question_num, gameObj, answered_right});
          setQuestNumber(to_question_num);
        }

        //If answered right make confetti, celebrate and switch to the next question
        if (onRightAnswer) {
          const to_question_num = findFirstUnansweredQuestion(quest_ids, answered_right, gameObj);
          console.log({ to_question_num });
          triggerConfetti();
          toast.success(
            "Right! Look for a prize in your wallet when Score is 1, 3, 7, or 10!!!"
          );
          setQuestNumber(to_question_num);
        }
        console.log({ level, answered_right });

        //In case of wrong answer, shake screen, apply red color effect, and notify
        console.log(wrong_dict, answeredWrongRef.current)
        if (answeredWrongRef.current) compareAndNotify(wrong_dict, answeredWrongRef.current,
          (key, newValue) => {
            handleWrongAnswer();
            toast.error(
              `Sorry, the zk score came. It was a wrong answer. Please try more!!!`
            );
          }
        );
        setAnsweredWrong(wrong_dict);
        answeredWrongRef.current = wrong_dict;
        console.log("Set it the wrong to:", wrong_dict);
      }
    }

    fetcher();
    const intervalId = setInterval(fetcher, 2000);
    return () => { clearInterval(intervalId); console.log({ cleared: intervalId }) }
  }, [currentAccount, network, gotIt]);

  useEffect(() => {
    const fetch = async () => {
      //Set the current question info to match the selected question number
      const question = gameObject.questions[questNumber - 1]?.question;
      console.log({ question })
      setQuestion(question);
    }
    fetch().catch(() => { setQuestion("Question does not exist. Please try another one!") });
  }, [questNumber, gameObject])

  const handleSubmit = async (event, currentAccount, setOpen, gameObject) => {
    event.preventDefault();
    console.log({ event })
    console.log({ currentAccount });

    //Check if wallet connected to testnet, if not gently ask to connect to testnet
    if (!currentAccount?.address || !(network.name == "testnet" || network.name == "mainnet"))
    {
      toast.error(
        "Please connect your wallet to Aptos testnet or mainnet and submit again!"
      );
      toast.error(
        "Only Aptos testnet, and mainnet if (oracle still has money) works!"
      );
      disconnect();
      setOpen(true);
      return;
    }

    toast.info("Please approve the transaction to submit your answer :)");

    const quest_id = questNumber - 1;
    console.log({ quest_id, answer });

    //Use the function with zk proofs to generate the proving transaction
    const txBlock = await answer_quest(
      window.snarkjs,
      currentAccount.address,
      quest_id,
      answer,
      gameObject,
    );

    console.log({ txBlock });

    //Sign the transaction with the wallet got from useWallet hook
    await signAndSubmitTransaction({ sender: account.address, data: txBlock });

    //Warn that scoring by oracle run on my computer
    //Will take some time for transaction to pass
    //Hopefully it is running stable!
    toast.warning("Please wait 10-20 seconds to get zkScored!");

    //Reset the answer field
    setAnswer("");
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // Prevent the default Enter key behavior in the input
      handleSubmit(event, currentAccount, setOpen, gameObject);
    }
  };

  return (
    <>
      {showConfetti && <Confetti width={width} height={height} />}
      <Container isShaking={isShaking}>
        <Flex style={{ alignItems: "center" }}>
          <ImageLogo src="/AptlyLogo.png" alt="Logo with text saying Aptly" />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1px',
              //padding: '20px'
            }}>
            <AntdWalletSelector />
            Score: {level}
          </div>
        </Flex>
        {
          spinning ? (
            <Form onSubmit={(event) => handleSubmit(event, currentAccount, setOpen, gameObject)}>
              <InputColumn>

                <StyledText
                  marginTop="100px">Aptos Quest</StyledText>
                <NumberSelector
                  max={gameObject.questions.length}
                  doneList={answeredRight ? answeredRight.map(q => parseInt(q, 10) + 1) : []}
                  setQuestNumber={setQuestNumber}
                  questNumber={questNumber}
                ></NumberSelector>
                <Question
                  style={{ marginBottom: 100 }}
                >
                  {question?.includes("[[OPTIONS]]") ? question.split("[[OPTIONS]]")[0] : question}
                </Question>
                {/* answeredRight.includes(quest_ids[questNumber - 1]) */}
                {(false) ? (
                  <p>Good job! You briliantly answered this question. Remember? ;) Answer all other questions for the 10000$ prize.</p>
                ) : (<>
                  {question?.includes("[[OPTIONS]]") ? <>
                    <StyledText
                      style={{ marginBottom: 20 }}>Pick your answer here</StyledText>
                    <QuestionWithChoices
                      questionText={question}
                      setAnswer={setAnswer}
                      handleSubmit={handleSubmit}
                      currentAccount={currentAccount}
                      gameObject={gameObject}
                      setOpen={() => console.log("Opened")}
                    />

                  </>
                    : <>
                      <StyledText
                        marginTop="100px">Type your answer here</StyledText>
                      <Input
                        type="text"
                        placeholder="???"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        onKeyDown={handleKeyDown}
                      />
                      <MintButton type="submit">
                        <ButtonImg
                          src="/zkAnswer.svg"
                          alt="Logo with text"
                        />
                      </MintButton></>}

                </>
                )}
              </InputColumn>
            </Form>
          ) : (
            <ImageColumn>
              <QuestionImg
                marginTop="0px"
                width="80%"
                src="/Congrats.svg"
                alt="Logo with text"
              />
              <Question>
                You answered right! The zkPrize you got in the
                wallet is special. It assures the contract got a valid zkProof of a matching
                answer.{" "}
              </Question>
              <Image src={image} alt="A reward coin" />
            </ImageColumn>
          )
          //
        }


      </Container>
    </>
  );
};

const App = () => {
  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{ network: Network.TESTNET }}
      onError={(error) => {
        console.log("error", error);
      }}>
      <ToastContainer />
      <Main></Main>
    </AptosWalletAdapterProvider>
  );
};

export default App;


///////////////////////////////////////////////////
//All the styled components and then design elements and some react components go here
//Will move to a separate file on the next refactoring
///////////////////////////////////////////////////

//Define the styled components for the demo website
const Container = styled.div`
  padding: 30px;
  border-radius: 40px;
  background-color: #b67bdb;
  ${(props) => props.isShaking ? "animation: blink-red 2.0s ease;" : ""}
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  min-height: 1000px;
  max-width: 500px;
  width: 500px;
  max-height: 1000px;

  @keyframes blink-red {
  0% { background-color: rgba(255, 0, 0, 0.8); transform: translateX(-10px); }
  10% { transform: translateX(0px); }
  20% { transform: translateX(+10px); }
  30% { transform: translateX(0px);}
  100% { background-color: #b67bdb; }}

  @keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-10px); }
  40%, 80% { transform: translateX(10px); }
  }

}
`;

const ImageLogo = styled.img`
  margin-left: 20px;
  width: 220px;
  align-self: flex-start;
  justify-self: flex-start;
`;

const Image = styled.img`
  width: 70%;
  align-self: center;
  justify-self: center;
`;

const ButtonImg = styled.img`
  width: 90%;
  align-self: center;
  justify-self: center;
`;

const QuestionImg = styled.img`
  margin-bottom: 20px;
  width: ${(props) => props.width};
  margin-top: ${(props) => props.marginTop};
  align-self: center;
  justify-self: center;
`;

const Question = styled.h2`
  font-family: "Krub", sans-serif;
  font-size: 24px;
  margin-bottom: 20px;
  margin-top: -15px;
  color: #ffffff;
  text-align: center;
`;

const Hint = styled.p`
  font-family: "Krub", sans-serif;
  font-size: 19px;
  margin-bottom: 20px;
  color: #000;
  text-align: center;
`;

const Input = styled.input`
  //margin-top: 10px;
  font-family: "Krub", sans-serif;
  width: 70%;
  height: 40px;
  padding: 10px;
  //margin-bottom: 20px;
  border-radius: 20px;
  background-color: rgba(255, 255, 255, 0.0); 
  border: 2px solid white; 
  font-size: 26px;
  color: #ffffff;
  text-align: center;
  ::placeholder {
    color: #BABABA;
  }
  &:focus {
    outline: 5px solid #DBFF00;
  }
`;

const Button = styled.button`
  font-family: "Krub", sans-serif;
  background-color: #00c853;
  color: #fff;
  font-size: 16px;
  font-weight: bold;
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  //box-shadow: 0px 5px 5px rgba(0, 0, 0, 0.5);
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: #C9FF55;
    //box-shadow: 0px 7px 7px rgba(0, 0, 0, 0.5);
    transform: translateY(-2px);
  }

  &:focus {
    outline: 5px solid #A23EE0;
  }

  &:active {
    background-color: #8EF66A;
    //box-shadow: 0px 2px 2px rgba(0, 0, 0, 0.5);
    transform: translateY(2px);
  }
`;

const pulse = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(255, 223, 0, 0.7);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(255, 223, 0, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 223, 0, 0);
  }
`;

const MintButton = styled(Button)`
  animation: ${pulse} 2s infinite;
  width: 200px;
  height: 50px;
  font-size: 24px;
  font-weight: 900;
  border-radius: 15px;
  font-family: "Krub", sans-serif;
  background-color: #dbff00;
  margin-top: 20px;
`;

const Form = styled.form`
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  align-self: center;
  max-width: 500px;
  width: 90%;
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  justify-self: center;
  width: 100%;
  margin-bottom: 20px;
`;

const Flex = styled.div`
  margin-bottom: 50px;
  display: flex;
  justify-content: space-between;
  flex-direction: row;
  //align-items: flex-end;
  //justify-content: flex-end;
  justify-self: flex-start;
  align-self: flex-start;
  width: 100%;
  margin-top: 20px;
`;

const InputColumn = styled(Column)``;

const ImageColumn = styled(Column)`
  margin-top: 20px;
`;

// Styled components for the Question Selector
const Container1 = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0px;
`;

const NumberContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  align-content: center;
  margin: 20px 0;
`;
//'#dbff00'
const NumberButton = styled.div`
  width: ${(props) => props.isChosen ? "37px" : "30px"}; /* Circle size adjusted */
  height: ${(props) => props.isChosen ? "37px" : "30px"};
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: ${(props) =>
    props.isChosen ? '#dbff00' : props.done ? '#C0C0C0' : "#ffffff"};
  color: #b67bdb;
  font-size: 14px;
  font-weight: bold;
  border-radius: 50%;
  cursor: ${(props) => (props.done ? 'not-allowed' : 'pointer')};
  transition: transform 0.2s ease, background-color 0.2s ease;

  &:hover {
    transform: ${(props) => (props.isChosen ? 'none' : 'scale(1.23)')};
  }
`;

// Styled component for grid container
const GridContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  width: 100%;
  margin: 0 auto;
`;

// Styled component for grid item (choice button)
const ChoiceButton = styled.button`
  padding: 10px;
  font-size: 22px;
  border-radius: 10px;
  background-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  border: 2px solid #ffffff;
  text-align: center;
  cursor: pointer;

  &:hover {
    background-color: rgba(255, 255, 255, 0.4);
    border-color : #dbff00;
  }

  
  &:active {
    outline : 0px;
    background-color : rgba(219, 255, 0, 1.0);
  }

  // &:focus {
  //   outline: 5px solid #DBFF00;
  // }
`;

const StyledText = styled.div`
  color: #DBFF00; /* Bright yellow text */
  font-family: "Poppins", sans-serif;
  font-weight: 900; /* Black weight */
  font-size: 30px; /* Adjust size according to your design */
  padding: 10px 20px; /* Add padding for better layout */
  text-align: center; /* Center align the text */
`;

//Question numberselector component
const NumberSelector = ({ max, doneList, setQuestNumber, questNumber }) => {
  const handleClick = (num) => {
    //Allow chosing again for now
    if (!doneList.includes(num)) {
      setQuestNumber(num);
    }
    //setQuestNumber(num);
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (questNumber < max) {
      setQuestNumber(questNumber + 1);
    }
  };

  const handlePrevious = (e) => {
    e.preventDefault();
    if (questNumber > 1) {
      setQuestNumber(questNumber - 1);
    }
  };

  return (
    <Container1>
      <NumberContainer>
        {Array.from({ length: max }, (_, index) => {
          const number = index + 1;
          const isDone = doneList.includes(number);
          const isChosen = questNumber === number;

          return (
            <div key={number} style={{ jusifyContent: "center", alignContent: "center" }}>
              <NumberButton
                data-tip={isDone ? `Question ${numberToAlphabet(number)} is already answered.` : "Click to select this question!"}
                done={isDone}
                isChosen={isChosen}
                onClick={() => handleClick(number)}
              >
                {numberToAlphabet(number)}
              </NumberButton>
              <ReactTooltip />
            </div>
          );
        })}
      </NumberContainer>
      <ReactTooltip />
    </Container1>
  );
};

// Selector of answers for multiple answer question
const QuestionWithChoices = ({ questionText, setAnswer, handleSubmit, currentAccount, setOpen, gameObject }) => {
  // Function to parse options from the question text
  const parseOptions = (text) => {
    const optionsPart = text.match(/\[\[OPTIONS\]\]:\s*(.*)$/)?.[1];
    if (!optionsPart) return [];
    return optionsPart.split(', ').map(option => option.trim());
  };

  // Get the options
  const options = parseOptions(questionText);

  // Handle option click
  const handleOptionClick = (option, gameObject) => {
    console.log("Option click handled");
    setAnswer(option.split(')')[0]);
    handleSubmit(option, currentAccount, setOpen, gameObject); // Invoke handleSubmit after setting the answer
  };

  return (
    <>
      <GridContainer>
        {options.map((option, index) => (
          <ChoiceButton key={index} onClick={() => handleOptionClick(option, gameObject)}>
            {option}
          </ChoiceButton>
        ))}
      </GridContainer>
    </>
  );
};
