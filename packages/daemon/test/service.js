import { E, Far } from '@endo/far';

export const make = powers => {
  return Far('Service', {
    async ask() {
      return E(powers).request(
        'HOST',
        'the meaning of life, the universe, everything',
        'answer',
      );
    },
  });
};
