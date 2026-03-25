"""Usage Redistribution Signal - adjusts projections for injury-driven usage changes."""
import json,os,logging
from typing import Dict,Any,Optional,List
from .base import BaseSignal,SignalResult,registry
logger=logging.getLogger(__name__)

class UsageRedistributionSignal(BaseSignal):
    name="usage_redistribution"
    description="Injury-based usage redistribution boost"
    stat_types=["Points","Rebounds","Assists","3-Pointers Made","Pts+Rebs+Asts","Steals","Blocks","Turnovers","Pts+Rebs","Pts+Asts","Rebs+Asts"]
    default_confidence=0.62
    STAT_MAP={"Points":["points","pts"],"Rebounds":["rebounds","reb"],"Assists":["assists","ast"],"3-Pointers Made":["fg3m"],"Steals":["steals","stl"],"Blocks":["blocks","blk"],"Turnovers":["turnovers","tov"],"Pts+Rebs+Asts":["points","pts","rebounds","reb","assists","ast"],"Pts+Rebs":["points","pts","rebounds","reb"],"Pts+Asts":["points","pts","assists","ast"],"Rebs+Asts":["rebounds","reb","assists","ast"]}

    def _load_redist(self):
        try:
            p=os.path.join(os.path.dirname(__file__),'..','..','data','usage_redistribution.json')
            if os.path.exists(p):
                with open(p) as f: return json.load(f)
        except: pass
        return {}

    def _get_boost(self,player_id,team_id,stat_type,context):
        ib=context.get('injury_boosts',{})
        op=context.get('out_players',[])
        if not ib:
            rd=self._load_redist();rs=rd.get('redistributions',{})
            if team_id in rs: ib=rs[team_id].get('boosts',{});op=rs[team_id].get('out_players',[])
            else: return 0.0,[]
        pb=ib.get(player_id,{})
        if not pb: return 0.0,op
        keys=self.STAT_MAP.get(stat_type,[]);total=0.0;seen=set()
        for k in keys:
            for pk,pv in pb.items():
                if (pk==k or pk.rstrip('s')==k.rstrip('s')) and pk not in seen:
                    total+=float(pv);seen.add(pk)
        return total,op

    def calculate(self,player_id,game_date,stat_type,context):
        tid=str(context.get('team_id',context.get('team','')))
        boost,op=self._get_boost(player_id,tid,stat_type,context)
        if boost<=0: return self._create_neutral_result()
        baseline=self._get_baseline(stat_type,context)
        if baseline is None or baseline<=0: return self._create_neutral_result()
        adj=min(boost,baseline*0.30)
        conf=min(0.55+(adj/baseline)*0.5,0.78)
        return SignalResult(adjustment=adj,direction='OVER',confidence=conf,signal_name=self.name,fired=True,metadata={'raw_boost':boost,'capped_adj':adj,'baseline':baseline,'boost_pct':round(adj/baseline*100,1),'out_players':op[:5]},sample_size=1)

    def _get_baseline(self,stat_type,context):
        from .stat_helpers import get_baseline
        return get_baseline(stat_type,context)

registry.register(UsageRedistributionSignal())
