import { useLocalSearchParams } from 'expo-router';

import { Screen } from '@/components/ui';
import { PatientRecordScreen } from '@/features/records/PatientRecordScreen';

/** Ficha (prontuário) de um paciente. ?atendimento=<id> abre já pronto para registrar aquele atendimento. */
export default function PatientRecordRoute() {
  const { contactId, atendimento } = useLocalSearchParams<{ contactId: string; atendimento?: string }>();
  return (
    <Screen wide safeTop={false}>
      {/* key: ao trocar de paciente, a tela recomeça do zero (sem restos do anterior). */}
      <PatientRecordScreen key={contactId} contactId={String(contactId)} appointmentId={atendimento ? String(atendimento) : null} />
    </Screen>
  );
}
