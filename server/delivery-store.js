// Supply a server-only Supabase client. Never expose its service-role key to Vite.
export function createDeliveryStore(client) {
  if(typeof client?.rpc!=='function') throw new Error('Server database client required');
  return {
    async claim(key) {
      const {data,error}=await client.rpc('claim_access_mail',{p_key:key});
      if(error||!['claimed','accepted','blocked'].includes(data)) throw new Error('Delivery claim unavailable');
      return data;
    },
    async finish(key,outcome) {
      const {error}=await client.rpc('finish_access_mail',{p_key:key,p_state:outcome.state});
      if(error) throw new Error('Delivery completion unavailable');
    }
  };
}
