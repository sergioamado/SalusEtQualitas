import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';

import { Button, Checkbox, Field, Notice, SectionLabel, Title } from '@/components/ui';
import { Space } from '@/constants/theme';
import {
  isValidEmail,
  isValidFullName,
  isValidPhone,
  maskCep,
  maskPhone,
  onlyDigits,
} from '@/lib/format';
import { lookupCep } from '@/lib/viacep';

import {
  book,
  BookingError,
  type Address,
  type BookingResult,
  type Modality,
  type PublicClinic,
  type PublicProcedure,
  type Slot,
} from './api';
import { BookingShell, type ShellProps } from './BookingShell';

type CepState = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

const EMPTY_ADDRESS: Address = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

export function DetailsStep({
  shell,
  clinic,
  procedure,
  modality,
  slot,
  onBooked,
  onSlotTaken,
}: {
  shell: ShellProps;
  clinic: PublicClinic;
  procedure: PublicProcedure;
  modality: Modality;
  slot: Slot;
  onBooked: (result: BookingResult) => void;
  onSlotTaken: (error: BookingError) => void;
}) {
  const home = modality === 'residencial';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [autoFilled, setAutoFilled] = useState<Partial<Record<keyof Address, boolean>>>({});
  const [cepState, setCepState] = useState<CepState>('idle');
  const [consent, setConsent] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const numberRef = useRef<TextInputInstance>(null);
  const cepRequest = useRef(0);

  const setAddr = (key: keyof Address, value: string) => setAddress((a) => ({ ...a, [key]: value }));

  // RF12: CEP completo -> preenche Rua, Bairro, Cidade e UF
  const onCepChange = async (text: string) => {
    const masked = maskCep(text);
    setAddr('cep', masked);
    if (onlyDigits(masked).length !== 8) {
      setCepState('idle');
      return;
    }
    const request = ++cepRequest.current;
    setCepState('loading');
    const res = await lookupCep(masked);
    if (request !== cepRequest.current) return; // usuário digitou outro CEP
    if (res.ok) {
      setAddress((a) => ({ ...a, ...res.address }));
      setAutoFilled({
        street: !!res.address.street,
        district: !!res.address.district,
        city: !!res.address.city,
        state: !!res.address.state,
      });
      setCepState('found');
      numberRef.current?.focus();
    } else {
      setAutoFilled({});
      setCepState(res.reason === 'network' ? 'error' : 'not_found');
    }
  };

  const errors = {
    fullName: isValidFullName(fullName) ? null : 'Informe nome e sobrenome.',
    email: isValidEmail(email) ? null : 'Informe um e-mail válido.',
    phone: isValidPhone(phone) ? null : 'Informe o celular com DDD.',
    cep: !home || onlyDigits(address.cep).length === 8 ? null : 'Informe um CEP com 8 dígitos.',
    street: !home || address.street.trim() ? null : 'Informe a rua.',
    number: !home || address.number.trim() ? null : 'Informe o número (ou "S/N").',
    district: !home || address.district.trim() ? null : 'Informe o bairro.',
    city: !home || address.city.trim() ? null : 'Informe a cidade.',
    state: !home || /^[A-Za-z]{2}$/.test(address.state.trim()) ? null : 'UF com 2 letras.',
    consent: consent ? null : 'Necessário para concluir o agendamento.',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const err = (key: keyof typeof errors) => (showErrors ? errors[key] : null);

  const submit = async () => {
    setShowErrors(true);
    setSubmitError(null);
    if (hasErrors) return;
    setSubmitting(true);
    try {
      const result = await book({
        slug: clinic.slug,
        procedureId: procedure.id,
        professionalId: slot.professional_id,
        startsAt: slot.starts_at,
        modality,
        fullName: fullName.trim(),
        email: email.trim(),
        phone: onlyDigits(phone),
        address: home ? { ...address, cep: onlyDigits(address.cep), state: address.state.trim().toUpperCase() } : null,
        consent,
      });
      onBooked(result);
    } catch (e) {
      const error = e instanceof BookingError ? e : new BookingError('UNKNOWN');
      if (error.code === 'SLOT_UNAVAILABLE') onSlotTaken(error);
      else setSubmitError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cepHint = {
    idle: 'Digite o CEP para preencher o endereço automaticamente.',
    loading: 'Buscando endereço…',
    found: 'Endereço encontrado. Complete com número e complemento.',
    not_found: null,
    error: null,
  }[cepState];
  const cepError =
    cepState === 'not_found'
      ? 'CEP não encontrado. Confira ou preencha o endereço manualmente.'
      : cepState === 'error'
        ? 'Não foi possível buscar o CEP agora. Preencha o endereço manualmente.'
        : err('cep');

  return (
    <BookingShell
      {...shell}
      footer={
        <Button
          label={clinic.auto_confirm ? 'Confirmar agendamento' : 'Solicitar agendamento'}
          loading={submitting}
          onPress={submit}
        />
      }>
      <Title>Seus dados</Title>

      <Field
        label="Nome completo"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="next"
        error={err('fullName')}
      />
      <Field
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={err('email')}
      />
      <Field
        label="Telefone (WhatsApp)"
        value={phone}
        onChangeText={(t) => setPhone(maskPhone(t))}
        autoComplete="tel"
        textContentType="telephoneNumber"
        keyboardType="phone-pad"
        placeholder="(11) 91234-5678"
        error={err('phone')}
      />

      {home ? (
        <>
          <SectionLabel>Endereço do atendimento</SectionLabel>
          <Field
            label="CEP"
            value={address.cep}
            onChangeText={onCepChange}
            autoComplete="postal-code"
            textContentType="postalCode"
            keyboardType="number-pad"
            placeholder="00000-000"
            hint={cepHint}
            error={cepError}
          />
          <Field
            label="Rua"
            value={address.street}
            onChangeText={(t) => setAddr('street', t)}
            editable={!autoFilled.street}
            autoComplete="street-address"
            error={err('street')}
          />
          <View style={styles.row}>
            <Field
              ref={numberRef}
              label="Número"
              value={address.number}
              onChangeText={(t) => setAddr('number', t)}
              style={styles.narrow}
              error={err('number')}
            />
            <Field
              label="Complemento"
              value={address.complement}
              onChangeText={(t) => setAddr('complement', t)}
              placeholder="Apto, bloco…"
              style={styles.wide}
            />
          </View>
          <Field
            label="Bairro"
            value={address.district}
            onChangeText={(t) => setAddr('district', t)}
            editable={!autoFilled.district}
            error={err('district')}
          />
          <View style={styles.row}>
            <Field
              label="Cidade"
              value={address.city}
              onChangeText={(t) => setAddr('city', t)}
              editable={!autoFilled.city}
              style={styles.wide}
              error={err('city')}
            />
            <Field
              label="UF"
              value={address.state}
              onChangeText={(t) => setAddr('state', t.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}
              editable={!autoFilled.state}
              autoCapitalize="characters"
              style={styles.narrow}
              error={err('state')}
            />
          </View>
        </>
      ) : null}

      <Checkbox checked={consent} onChange={setConsent}>
        Autorizo {clinic.name} a usar meus dados somente para este agendamento e para contato sobre ele,
        conforme a LGPD.
      </Checkbox>
      {err('consent') ? <Notice tone="danger">{errors.consent}</Notice> : null}
      {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
    </BookingShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Space.md },
  narrow: { flex: 1 },
  wide: { flex: 2 },
});
