import { ParamDetails, Arg, Option } from '../../register-command';

import { commonOptions } from '../utils';

import { TxParams } from '@openzeppelin/upgrades';
import NetworkFile from '../../models/files/NetworkFile';
import { DEFAULT_TX_TIMEOUT } from '../../models/network/defaults';

const kinds = ['regular', 'upgradeable', 'minimal'] as const;
type Kind = typeof kinds[number]; // Union of all members of the kinds array.

export interface Args {
  contract: string;
  arguments: string[];
}

export interface Options {
  from?: string;
  network?: string;
  skipCompile?: boolean;
  kind?: Kind;
  // The following are not available as CLI flags, they are only used internally.
  userNetwork?: string;
  networkFile?: NetworkFile;
  txParams?: TxParams;
  implicitActions?: boolean;
}

export const name = 'deploy';
export const description = 'deploy a contract instance';

export const args: Arg[] = [
  {
    name: 'contract',
    async details(): Promise<ParamDetails> {
      const choices = await import('../../prompts/choices');

      const contracts = choices.contracts('all');

      return {
        prompt: 'Pick a contract to deploy',
        choices: contracts,
      };
    },
  },
  {
    name: 'arguments',
    variadic: true,
    async details(params: Options & Args): Promise<ParamDetails[]> {
      const { fromContractFullName } = await import('../../utils/naming');
      const { default: ContractManager } = await import('../../models/local/ContractManager');
      const { argLabelWithIndex } = await import('../../prompts/prompt');
      const { parseArg, getSampleInput } = await import('../../utils/input');
      const { getConstructorInputs } = await import('@openzeppelin/upgrades');

      const contractFullName = params.contract;

      const { package: packageName, contractName } = fromContractFullName(contractFullName);
      const contract = new ContractManager().getContractClass(packageName, contractName);
      const constructorInputs = getConstructorInputs(contract);

      return constructorInputs.map((arg, index) => ({
        prompt: `${argLabelWithIndex(arg, index)}:`,
        validationError: (value: string) => {
          try {
            parseArg(value, arg);
          } catch (err) {
            const placeholder = getSampleInput(arg);
            if (placeholder) {
              return `Enter a valid ${arg.type} such as: ${placeholder}`;
            } else {
              return `Enter a valid ${arg.type}`;
            }
          }
        },
      }));
    },
  },
];

export const options: Option[] = [
  {
    format: '--skip-compile',
    description: 'use existing compilation artifacts',
    default: false,
  },
  {
    format: '-k, --kind <kind>',
    description: `the kind of deployment (${kinds.join(', ')})`,
    async details() {
      return {
        prompt: 'Choose the kind of deployment',
        choices: kinds,
      };
    },
  },
  {
    format: '-n, --network <network>',
    description: 'network to use',
    async details() {
      const { default: ConfigManager } = await import('../../models/config/ConfigManager');
      const { default: Session } = await import('../../models/network/Session');

      const networks = ConfigManager.getNetworkNamesFromConfig();
      const { network: lastNetwork, expired } = Session.getNetwork();

      if (expired || lastNetwork === undefined) {
        return {
          prompt: 'Pick a network',
          choices: networks,
          preselect: lastNetwork,
        };
      }
    },
    async after(options: Options) {
      if (options.network) {
        const { default: Session } = await import('../../models/network/Session');
        // Used for network preselection in subsequent runs.
        Session.setDefaultNetworkIfNeeded(options.network);
      }
    },
  },
  {
    format: '--timeout <timeout>',
    description: `timeout in seconds for each transaction (default: ${DEFAULT_TX_TIMEOUT})`,
  },
  {
    format: '-f, --from <address>',
    description: 'sender for the contract creation transaction',
    async after(options: Options) {
      // Once we have all required params (network, timeout, from) we initialize the config.
      // We need to do this because it's necessary for the details of 'arguments' later.
      if (process.env.NODE_ENV !== 'test') {
        const { default: ConfigManager } = await import('../../models/config/ConfigManager');
        const userNetwork = options.network;
        const config = await ConfigManager.initNetworkConfiguration(options);
        Object.assign(options, config, { userNetwork });
      }
    },
  },
  {
    format: '--migrate-manifest',
    description: 'enable automatic migration of manifest format',
    async details(options: Options) {
      const { isMigratableManifestVersion } = await import('../../models/files/ManifestVersion');
      const { default: NetworkFile } = await import('../../models/files/NetworkFile');

      const version = NetworkFile.getManifestVersion(options.network);

      if (isMigratableManifestVersion(version)) {
        return {
          prompt: 'An old manifest version was detected and needs to be migrated to the latest one. Proceed?',
          promptType: 'confirm',
          validationError: (migrate: boolean) =>
            migrate ? undefined : 'Cannot proceed without migrating the manifest file.',
        };
      }
    },
  },
  commonOptions.noInteractive,
];
