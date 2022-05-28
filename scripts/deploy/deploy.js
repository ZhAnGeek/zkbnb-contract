const {ethers} = require("hardhat");
const namehash = require('eth-ens-namehash')
const fs = require('fs')
const {getKeccak256, saveDeployedAddresses} = require("./utils");

async function main() {
    const [owner] = await ethers.getSigners();
    const governor = owner.address;

    const contractFactories = await getContractFactories()
    //  Step 1: deploy zns registry
    console.log('Deploy ZNS registry...')
    const znsRegistry = await contractFactories.ZNSRegistry.deploy();
    await znsRegistry.deployed();

    // Step 2: deploy proxied contract
    // governance
    console.log('Deploy Governance...')
    const governance = await contractFactories.Governance.deploy();
    await governance.deployed();
    // verifier
    console.log('Deploy Verifier...')
    const verifier = await contractFactories.Verifier.deploy()
    await verifier.deployed()
    // zecrey legend
    console.log('Deploy ZecreyLegend...')
    const zecreyLegend = await contractFactories.ZecreyLegend.deploy()
    await zecreyLegend.deployed()
    // ZNS controller
    console.log('Deploy ZNSController...')
    const znsController = await contractFactories.ZNSController.deploy();
    await znsController.deployed();
    // ZNS resolver
    console.log('Deploy ZNSResolver...')
    const znsResolver = await contractFactories.ZNSResolver.deploy();
    await znsResolver.deployed();

    // Step 3: initialize deploy factory and finish deployment
    // deploy price oracle
    console.log('Deploy PriceOracle...')
    const priceOracle = await contractFactories.ZNSPriceOracle.deploy([0,1,2]);
    await priceOracle.deployed();

    // prepare deploy params
    // get ERC20s
    console.log('Deploy Tokens...')
    const totalSupply = ethers.utils.parseEther('100000000')
    const LEGToken = await contractFactories.TokenFactory.deploy(totalSupply, 'LEG', 'LEG')
    await LEGToken.deployed()
    const REYToken = await contractFactories.TokenFactory.deploy(totalSupply, 'REY', 'REY')
    await REYToken.deployed()

    const _genesisAccountRoot = '0x01ef55cdf3b9b0d65e6fb6317f79627534d971fd96c811281af618c0028d5e7a';
    const _listingFee = ethers.utils.parseEther('100');
    const _listingCap = 2 ** 16 - 1;
    const _listingToken = LEGToken.address
    const baseNode = namehash.hash('legend');
    // deploy DeployFactory
    console.log('Deploy DeployFactory...')
    const deployFactory = await contractFactories.DeployFactory.deploy(
        governance.address, verifier.address, zecreyLegend.address, znsController.address, znsResolver.address,
        _genesisAccountRoot, verifier.address, governor, _listingToken, _listingFee, _listingCap,
        znsRegistry.address, priceOracle.address, baseNode
    );
    await deployFactory.deployed();

    // Get deployed proxy contracts and the gatekeeper contract,
    // they are used for invoking methods.
    const deployFactoryTx = await deployFactory.deployTransaction;
    const deployFactoryTxReceipt = await deployFactoryTx.wait();
    const AddressesInterface = new ethers.utils.Interface(["event Addresses(address governance, address assetGovernance, address verifier, address znsController, address znsResolver, address zecreyLegend, address gatekeeper)"]);
    // The specified index is the required event.
    // console.log(deployFactoryTxReceipt.logs)
    let event = AddressesInterface.decodeEventLog("Addresses", deployFactoryTxReceipt.logs[8].data, deployFactoryTxReceipt.logs[8].topics);
    // Get inner contract proxy address
    // console.log(event)
    const znsControllerProxy = contractFactories.ZNSController.attach(event[3])
    const assetGovernance = contractFactories.AssetGovernance.attach(event[1])

    // Add tokens into assetGovernance
    // add asset
    console.log('Add tokens into assetGovernance asset list...')
    let addAssetTx0 = await assetGovernance.addAsset(LEGToken.address);
    await addAssetTx0.wait()
    let addAssetTx1 = await assetGovernance.addAsset(REYToken.address)
    await addAssetTx1.wait()

    // Step 4: register zns base node
    console.log('Register ZNS base node...')
    const rootNode = namehash.hash('');
    const baseNameHash = getKeccak256('legend');
    const setBaseNodeTx = await znsRegistry.connect(owner).setSubnodeOwner(rootNode, baseNameHash, znsControllerProxy.address, ethers.constants.HashZero);
    await setBaseNodeTx.wait();

    // Save addresses into JSON

    console.log('Save deployed contract addresses...')
    saveDeployedAddresses('info/addresses.json', {
        governance: event[0],
        assetGovernance: event[1],
        verifierProxy: event[2],
        znsControllerProxy: event[3],
        znsResolverProxy: event[4],
        zecreyLegendProxy: event[5],
        upgradeGateKeeper: event[6],
        LEGToken: LEGToken.address,
        REYToken: REYToken.address
    })
}

async function getContractFactories() {
    const Utils = await ethers.getContractFactory("Utils")
    const utils = await Utils.deploy()
    await utils.deployed()

    return {
        TokenFactory: await ethers.getContractFactory('ZecreyRelatedERC20'),
        ZNSRegistry: await ethers.getContractFactory('ZNSRegistry'),
        ZNSResolver: await ethers.getContractFactory('PublicResolver'),
        ZNSPriceOracle: await ethers.getContractFactory('StablePriceOracle'),
        ZNSController: await ethers.getContractFactory('ZNSController'),
        Governance: await ethers.getContractFactory('Governance'),
        AssetGovernance: await ethers.getContractFactory('AssetGovernance'),
        Verifier: await ethers.getContractFactory('ZecreyVerifier'),
        ZecreyLegend: await ethers.getContractFactory('ZecreyLegend', {
            libraries: {
                Utils: utils.address
            }
        }),
        DeployFactory: await ethers.getContractFactory('DeployFactory')
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Error:', err.message || err);
        process.exit(1);
    });