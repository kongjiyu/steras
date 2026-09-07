import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResetPasswordPage from './ResetPasswordPage';
const { reset } = vi.hoisted(() => ({reset:vi.fn()}));
vi.mock('firebase/auth',()=>({sendPasswordResetEmail:reset}));
vi.mock('../../config/firebase',()=>({auth:{},isFirebaseConfigured:true}));
beforeEach(()=>{ reset.mockReset(); });
function open(){render(<MemoryRouter><ResetPasswordPage/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'viewer@example.com'}});}
describe('Password recovery',()=>{
 it('uses Firebase email reset and shows an inline result without revealing account existence',async()=>{reset.mockResolvedValue(undefined);open();fireEvent.click(screen.getByRole('button',{name:'Send reset email'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('If an account'));expect(reset).toHaveBeenCalledWith({},'viewer@example.com');});
 it('preserves email and permits retry after network failure',async()=>{reset.mockRejectedValue({code:'auth/network-request-failed'});open();fireEvent.click(screen.getByRole('button',{name:'Send reset email'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Network error'));expect(screen.getByLabelText('Email address')).toHaveValue('viewer@example.com');expect(screen.getByRole('button',{name:'Send reset email'})).toBeEnabled();});
});
