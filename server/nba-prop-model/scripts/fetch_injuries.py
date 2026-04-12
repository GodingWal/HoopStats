#!/usr/bin/env python3
"""Fetch NBA injuries and calculate usage redistribution."""
import os,sys,json,logging
from datetime import datetime,date
import psycopg2,requests
import sys
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
logger=logging.getLogger(__name__)

def get_db():
    try: return psycopg2.connect(DATABASE_URL)
    except Exception as e: logger.error(f"DB fail: {e}"); return None

def fetch_injuries():
    injuries=[]
    try:
        r=requests.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",timeout=15,headers={'User-Agent':'Mozilla/5.0'})
        if r.status_code==200:
            for td in r.json().get('items',[]):
                ti=td.get('team',{});ta=ti.get('abbreviation','');tid=ti.get('id','')
                for ai in td.get('injuries',[]):
                    a=ai.get('athlete',{});s=ai.get('status','')
                    sr=s if isinstance(s,str) else s.get('type',{}).get('abbreviation','Unknown')
                    sm={'O':'Out','OUT':'Out','D':'Day-To-Day','DTD':'Day-To-Day','Q':'Questionable','P':'Probable','SUSP':'Suspended'}
                    injuries.append({'player_id':str(a.get('id','')),'player_name':a.get('displayName',a.get('fullName','Unknown')),'team_id':str(tid),'team':ta,'status':sm.get(sr.upper(),sr),'injury_detail':str(ai.get('details',''))[:200]})
            logger.info(f"Fetched {len(injuries)} injuries from ESPN")
    except Exception as e: logger.warning(f"ESPN fail: {e}")
    return injuries

def store_injuries(conn,injuries,gd):
    if not injuries: return
    cur=conn.cursor()
    try:
        cur.execute("DELETE FROM injury_report WHERE game_date=%s",(gd,))
        for i in injuries:
            cur.execute("INSERT INTO injury_report(player_id,player_name,team_id,team,status,injury_detail,game_date) VALUES(%s,%s,%s,%s,%s,%s,%s)",(i['player_id'],i['player_name'],i['team_id'],i['team'],i['status'],i.get('injury_detail',''),gd))
        conn.commit()
        logger.info(f"Stored {len(injuries)} injuries for {gd}")
    except Exception as e: conn.rollback();logger.error(f"Store fail: {e}")
    finally: cur.close()

def calc_redistribution(conn,gd):
    cur=conn.cursor();redist={}
    try:
        cur.execute("SELECT DISTINCT team_id,team,player_id,player_name FROM injury_report WHERE game_date=%s AND status IN ('Out','Suspended')",(gd,))
        out_players=cur.fetchall()
        if not out_players: return redist
        teams={}
        for tid,t,pid,pn in out_players:
            if tid not in teams: teams[tid]={'team':t,'players':[]}
            teams[tid]['players'].append({'player_id':pid,'player_name':pn})
        for tid,info in teams.items():
            out_pids=[p['player_id'] for p in info['players']]
            try:
                ph=','.join(['%s']*len(out_pids))
                cur.execute(f"SELECT player_id,season_averages FROM players WHERE player_id IN ({ph})",out_pids)
                total_out={}
                for pid,sa in cur.fetchall():
                    if sa:
                        sa=sa if isinstance(sa,dict) else json.loads(sa) if isinstance(sa,str) else {}
                        for k in ['points','pts','rebounds','reb','assists','ast','fg3m','stl','blk','tov']:
                            v=sa.get(k,0) or 0
                            if isinstance(v,(int,float)) and v>0: total_out[k]=total_out.get(k,0)+float(v)
                if total_out:
                    cur.execute(f"SELECT player_id,season_averages FROM players WHERE team_id=%s AND player_id NOT IN ({ph})",[tid]+out_pids)
                    actives=[]
                    for pid,sa in cur.fetchall():
                        if sa:
                            sa=sa if isinstance(sa,dict) else json.loads(sa) if isinstance(sa,str) else {}
                            mins=float(sa.get('min',sa.get('minutes',0)) or 0)
                            if mins>10: actives.append({'player_id':pid,'mins':mins})
                    if actives:
                        tm=sum(a['mins'] for a in actives)
                        boosts={}
                        for a in actives:
                            share=a['mins']/tm if tm>0 else 0
                            boosts[a['player_id']]={k:v*share for k,v in total_out.items()}
                        redist[tid]={'team':info['team'],'out_players':[p['player_name'] for p in info['players']],'boosts':boosts}
                        logger.info(f"  {info['team']}: {len(info['players'])} OUT -> {len(actives)} active")
            except Exception as e: logger.warning(f"Redist fail {tid}: {e}")
    except Exception as e: logger.error(f"Redist query fail: {e}")
    finally: cur.close()
    return redist

def main():
    gd=sys.argv[1] if len(sys.argv)>1 else date.today().strftime("%Y-%m-%d")
    logger.info(f"Fetching injuries for {gd}")
    conn=get_db()
    if not conn: sys.exit(1)
    try:
        inj=fetch_injuries();store_injuries(conn,inj,gd)
        redist=calc_redistribution(conn,gd)
        rf=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','usage_redistribution.json')
        os.makedirs(os.path.dirname(rf),exist_ok=True)
        with open(rf,'w') as f: json.dump({'game_date':gd,'redistributions':{k:v for k,v in redist.items()}},f,indent=2,default=str)
        oc=sum(len(v.get('out_players',[])) for v in redist.values())
        logger.info(f"Done: {len(inj)} injuries, {oc} OUT across {len(redist)} teams")
    finally: conn.close()

if __name__=='__main__': main()
