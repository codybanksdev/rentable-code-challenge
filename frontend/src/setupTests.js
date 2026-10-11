import '@testing-library/jest-dom';
import { configure } from '@testing-library/dom';
import { act } from 'react';

// @testing-library/user-event fires its events through the top-level copy of
// @testing-library/dom, while @testing-library/react configures only its own
// nested copy to run events inside React's act(). Without this, a click from
// userEvent updates state outside act(): React warns, and the update lands
// after the next line of the test instead of before it.
configure({
    eventWrapper: callback => {
        let result;
        act(() => {
            result = callback();
        });
        return result;
    },
});
